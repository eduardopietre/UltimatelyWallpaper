"""Sync service launcher."""

from __future__ import annotations

import argparse
import os
import re
import shutil
import socket
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
VENV_DIR = BASE_DIR / ".venv"
if sys.platform == "win32":
    VENV_PYTHON = VENV_DIR / "Scripts" / "python.exe"
    VENV_PYTHONW = VENV_DIR / "Scripts" / "pythonw.exe"
else:
    VENV_PYTHON = VENV_DIR / "bin" / "python"
    VENV_PYTHONW = VENV_PYTHON

REQUIREMENTS = BASE_DIR / "requirements.txt"
ENV_EXAMPLE = BASE_DIR / ".env.example"
ENV_FILE = BASE_DIR / ".env"
LOG_DIR = BASE_DIR / "logs"
DEFAULT_PORT = 8765


def console_python() -> Path:
    exe = Path(sys.executable)
    if sys.platform == "win32" and exe.name.lower() == "pythonw.exe":
        candidate = exe.with_name("python.exe")
        if candidate.exists():
            return candidate
    return exe


def in_project_venv() -> bool:
    try:
        if Path(sys.executable).resolve() == VENV_PYTHON.resolve():
            return True
        return Path(sys.prefix).resolve() == VENV_DIR.resolve()
    except OSError:
        return False


def find_system_python() -> Path:
    for name in ("python", "python3"):
        found = shutil.which(name)
        if found:
            return Path(found)
    raise SystemExit("Python not found. Install Python 3.10+ and add it to PATH.")


def create_venv() -> None:
    python = console_python()
    if not python.exists():
        python = find_system_python()
    print("Creating virtual environment...")
    subprocess.run([str(python), "-m", "venv", str(VENV_DIR)], check=True, cwd=BASE_DIR)


def install_dependencies() -> None:
    print("Installing dependencies...")
    subprocess.run(
        [str(VENV_PYTHON), "-m", "pip", "install", "--upgrade", "pip"],
        check=True,
        cwd=BASE_DIR,
    )
    subprocess.run(
        [str(VENV_PYTHON), "-m", "pip", "install", "-r", str(REQUIREMENTS)],
        check=True,
        cwd=BASE_DIR,
    )


def dependencies_ready() -> bool:
    import importlib.util

    for module in ("PIL", "pystray", "fastapi", "uvicorn"):
        if importlib.util.find_spec(module) is None:
            return False
    return True


def ensure_dependencies() -> None:
    if dependencies_ready():
        return
    print("Missing dependencies in project venv. Installing...")
    install_dependencies()
    if not dependencies_ready():
        raise SystemExit(f"Dependencies still missing. Run: {VENV_PYTHON} run.py setup")


def ensure_env_file() -> None:
    if not ENV_FILE.exists() and ENV_EXAMPLE.exists():
        shutil.copy(ENV_EXAMPLE, ENV_FILE)
        print("Created .env from .env.example - edit it with your Apple ID credentials.")


def setup() -> None:
    find_system_python()
    if not VENV_PYTHON.exists():
        create_venv()
    install_dependencies()
    ensure_env_file()
    print("Done. Run .\\run.ps1 to start the sync service.")


def ensure_ready() -> None:
    if not VENV_PYTHON.exists():
        print("Virtual environment not found. Running setup...")
        setup()


def reexec_in_venv() -> None:
    ensure_ready()
    current = Path(sys.executable).name.lower()
    if current == "pythonw.exe" and VENV_PYTHONW.exists():
        exe = VENV_PYTHONW
    elif current == "python.exe" and VENV_PYTHON.exists():
        exe = VENV_PYTHON
    else:
        exe = VENV_PYTHONW if VENV_PYTHONW.exists() else VENV_PYTHON
    os.execv(str(exe), [str(exe), str(Path(__file__).resolve()), *sys.argv[1:]])


def read_port() -> int:
    if not ENV_FILE.exists():
        return DEFAULT_PORT
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^\s*PORT\s*=\s*(\d+)\s*$", line, re.IGNORECASE)
        if match:
            return int(match.group(1))
    return DEFAULT_PORT


def find_listening_pid(port: int) -> int | None:
    if sys.platform != "win32":
        return None
    result = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, check=False)
    needle = f":{port} "
    for line in result.stdout.splitlines():
        if needle in line and "LISTENING" in line:
            parts = line.split()
            if parts:
                try:
                    return int(parts[-1])
                except ValueError:
                    continue
    return None


def port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def cleanup_launcher_logs() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    cutoff = datetime.now() - timedelta(days=7)
    for path in LOG_DIR.glob("launcher-*.log"):
        try:
            if datetime.fromtimestamp(path.stat().st_mtime) < cutoff:
                path.unlink()
        except OSError:
            pass


def write_launcher_log(message: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / f"launcher-{datetime.now():%Y-%m-%d}.log"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(f"{timestamp} INFO launcher: {message}\n")


def log_info(message: str, hidden: bool) -> None:
    write_launcher_log(message)
    if not hidden:
        print(message)


def check_port_available(port: int, hidden: bool) -> bool:
    if not port_in_use(port):
        return True

    pid = find_listening_pid(port)
    if pid:
        message = f"Sync service is already running on port {port} (PID {pid})."
        hint = (
            f"\nUse http://127.0.0.1:{port}/health or stop that process before starting another instance.\n"
            f"  taskkill /PID {pid} /F\n"
        )
    else:
        message = f"Port {port} is already in use."
        hint = f"\nUse http://127.0.0.1:{port}/health or stop the process using port {port}.\n"

    write_launcher_log(message)
    if not hidden:
        print()
        print(message)
        print(hint)
    return False


def start_tray(hidden: bool) -> int:
    log_info("Starting tray sync service.", hidden)
    if not hidden:
        port = read_port()
        print(f"Sync service running. API: http://127.0.0.1:{port}/health")
        print("Right-click the tray icon to exit.")

    from tray_app import SyncTrayApp

    SyncTrayApp().run()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync service launcher")
    parser.add_argument("--hidden", action="store_true", help="Suppress console output")
    subparsers = parser.add_subparsers(dest="command")
    subparsers.add_parser("setup", help="Create venv and install dependencies")
    args = parser.parse_args()

    if args.command == "setup":
        setup()
        return 0

    if not in_project_venv():
        reexec_in_venv()

    ensure_dependencies()
    cleanup_launcher_logs()
    port = read_port()
    if not check_port_available(port, args.hidden):
        return 1
    return start_tray(args.hidden)


if __name__ == "__main__":
    raise SystemExit(main())

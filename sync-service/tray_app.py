import hashlib
import logging
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import uvicorn
from PIL import Image, ImageDraw

import main as service

try:
    import pystray
except Exception as exc:
    service.logger.error("Tray dependency failed to load: %s", exc)
    raise


logger = logging.getLogger(__name__)
BASE_DIR = Path(__file__).resolve().parent
HASH_SKIP_DIRS = {".venv", "__pycache__", "logs", "cache", ".git"}
HASH_SKIP_NAMES = {".env"}
HASH_EXTENSIONS = {".py", ".txt", ".ps1", ".bat", ".md", ".json", ".toml", ".ini"}


def resolve_host() -> str:
    host = os.getenv("HOST", "127.0.0.1").strip()
    if host.lower() == "localhost":
        return "127.0.0.1"
    return host


def resolve_port() -> int:
    return int(os.getenv("PORT", "8765"))


def directory_version_hash(root: Path = BASE_DIR) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if any(part in HASH_SKIP_DIRS for part in path.parts):
            continue
        if path.name in HASH_SKIP_NAMES:
            continue
        if path.suffix.lower() not in HASH_EXTENSIONS:
            continue
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(relative)
        digest.update(b"\0")
        try:
            digest.update(path.read_bytes())
        except OSError:
            continue
        digest.update(b"\0")
    return digest.hexdigest()[:8]


def handle_uncaught_exception(exc_type, exc_value, exc_traceback):
    logger.error("Unhandled tray application error", exc_info=(exc_type, exc_value, exc_traceback))


sys.excepthook = handle_uncaught_exception


def create_icon_image() -> Image.Image:
    image = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((10, 10, 54, 54), radius=12, fill=(16, 19, 24, 255))
    draw.rectangle((10, 18, 54, 26), fill=(58, 88, 142, 255))
    draw.ellipse((20, 34, 30, 44), fill=(57, 211, 83, 255))
    draw.ellipse((34, 34, 44, 44), fill=(255, 255, 255, 220))
    return image


class SyncTrayApp:
    def __init__(self) -> None:
        self.server: uvicorn.Server | None = None
        self.server_thread: threading.Thread | None = None
        self.icon: pystray.Icon | None = None
        self.server_error: Exception | None = None
        self.restart_requested = False
        self.version_hash = directory_version_hash()

    def start_server(self) -> None:
        host = resolve_host()
        port = resolve_port()
        config = uvicorn.Config(
            service.app,
            host=host,
            port=port,
            log_level="info",
            access_log=False,
            log_config=None,
        )
        self.server = uvicorn.Server(config)
        logger.info("Starting sync service on http://%s:%d", host, port)
        self.server.run()
        logger.info("Sync service server stopped")

    def run_server_thread(self) -> None:
        try:
            self.start_server()
        except Exception as exc:
            self.server_error = exc
            logger.exception("Sync service server failed")
            if self.icon:
                self.icon.stop()

    def wait_for_server(self, host: str, port: int, timeout: float = 30.0) -> bool:
        deadline = time.time() + timeout
        url = f"http://{host}:{port}/health"
        while time.time() < deadline:
            if self.server_error:
                return False
            try:
                with urllib.request.urlopen(url, timeout=1.0) as response:
                    if response.status == 200:
                        return True
            except (urllib.error.URLError, TimeoutError, OSError):
                pass
            time.sleep(0.2)
        return False

    def wait_for_port_free(self, host: str, port: int, timeout: float = 10.0) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(0.5)
                if sock.connect_ex((host, port)) != 0:
                    return True
            time.sleep(0.1)
        return False

    def open_directory(self, _icon=None, _item=None) -> None:
        logger.info("Opening sync service directory")
        try:
            os.startfile(BASE_DIR)
        except Exception as exc:
            logger.error("Failed to open sync service directory: %s", exc)

    def restart_app(self, icon=None, _item=None) -> None:
        logger.info("Restart requested from tray menu")
        self.restart_requested = True
        if self.server:
            self.server.should_exit = True
        if icon:
            icon.stop()

    def exit_app(self, icon=None, _item=None) -> None:
        logger.info("Exit requested from tray menu")
        if self.server:
            self.server.should_exit = True
        if icon:
            icon.stop()

    def relaunch(self) -> None:
        host = resolve_host()
        port = resolve_port()
        if not self.wait_for_port_free(host, port):
            logger.error("Port %d still in use; cannot restart", port)
            return

        exe = Path(sys.executable)
        script = BASE_DIR / "run.py"
        args = [str(exe), str(script), "--hidden"]
        kwargs: dict = {
            "cwd": str(BASE_DIR),
            "close_fds": True,
        }
        if sys.platform == "win32":
            kwargs["creationflags"] = (
                subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
            )
            kwargs["stdin"] = subprocess.DEVNULL
            kwargs["stdout"] = subprocess.DEVNULL
            kwargs["stderr"] = subprocess.DEVNULL
        logger.info("Relaunching sync service")
        subprocess.Popen(args, **kwargs)

    def run(self) -> None:
        host = resolve_host()
        port = resolve_port()
        logger.info("Tray application started (version %s)", self.version_hash)
        self.server_thread = threading.Thread(
            target=self.run_server_thread,
            name="sync-service-server",
            daemon=True,
        )
        self.server_thread.start()

        if not self.wait_for_server(host, port):
            if self.server_error:
                logger.error("Sync service failed to start: %s", self.server_error)
            else:
                logger.error("Sync service did not respond on http://%s:%d/health", host, port)
            raise SystemExit(1)

        menu = pystray.Menu(
            pystray.MenuItem(self.version_hash, None, enabled=False),
            pystray.MenuItem("Restart", self.restart_app),
            pystray.MenuItem("Open Directory", self.open_directory),
            pystray.MenuItem("Exit", self.exit_app),
        )
        self.icon = pystray.Icon(
            "icloud-calendar-sync",
            create_icon_image(),
            "iCloud Calendar Sync",
            menu,
        )

        try:
            logger.info("Tray icon initialized")
            self.icon.run()
        except Exception:
            logger.exception("Tray icon failed")
            if self.server:
                self.server.should_exit = True
            raise
        finally:
            if self.server:
                self.server.should_exit = True
            if self.server_thread:
                self.server_thread.join(timeout=5)
            logger.info("Tray application stopped")
            if self.restart_requested:
                self.relaunch()


if __name__ == "__main__":
    SyncTrayApp().run()

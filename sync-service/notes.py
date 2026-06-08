import json
import os
import re
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path


TASK_RE = re.compile(r"^([ \t]*)-\s+\[([ xX])\]\s?(.*)$")


@dataclass
class NoteFile:
    path: str
    name: str


@dataclass
class NoteTask:
    lineIndex: int
    text: str
    checked: bool
    depth: int
    raw: str


def notes_enabled_from_value(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def normalize_notes_root(folder_path: str) -> Path:
    root = Path(folder_path).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise ValueError("NOTES_FOLDER_PATH must be an existing directory")
    return root


def _picker_python() -> Path:
    exe = Path(sys.executable)
    if sys.platform == "win32" and exe.name.lower() == "pythonw.exe":
        candidate = exe.with_name("python.exe")
        if candidate.exists():
            return candidate
    return exe


def _resolve_initial_dir(initial_dir: str | None) -> str:
    if initial_dir:
        candidate = Path(initial_dir).expanduser()
        if candidate.is_dir():
            return str(candidate.resolve())
        if candidate.parent.is_dir():
            return str(candidate.parent.resolve())
    return str(Path.home())


def pick_notes_folder(initial_dir: str | None = None) -> str | None:
    if sys.platform != "win32":
        raise OSError("Folder picker is only supported on Windows")

    initial = _resolve_initial_dir(initial_dir)
    script = (
        "import json, os, sys, tkinter as tk\n"
        "from tkinter import filedialog\n"
        "root = tk.Tk()\n"
        "root.withdraw()\n"
        "root.attributes('-topmost', True)\n"
        "initial = sys.argv[1]\n"
        "path = filedialog.askdirectory(initialdir=initial, title='Select notes folder')\n"
        "print(json.dumps(path or ''))\n"
        "root.destroy()\n"
    )
    result = subprocess.run(
        [str(_picker_python()), "-c", script, initial],
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "Folder picker failed").strip()
        raise RuntimeError(detail)
    path = json.loads((result.stdout or '""').strip() or '""')
    return path or None


def prompt_text(title: str, prompt: str, initial: str = "") -> str | None:
    if sys.platform != "win32":
        raise OSError("Text prompt is only supported on Windows")

    payload = json.dumps({"title": title, "prompt": prompt, "initial": initial})
    script = (
        "import json, sys, tkinter as tk\n"
        "from tkinter import simpledialog\n"
        "data = json.loads(sys.argv[1])\n"
        "root = tk.Tk()\n"
        "root.withdraw()\n"
        "root.attributes('-topmost', True)\n"
        "value = simpledialog.askstring(\n"
        "    data['title'],\n"
        "    data['prompt'],\n"
        "    initialvalue=data.get('initial', ''),\n"
        "    parent=root,\n"
        ")\n"
        "print(json.dumps(value or ''))\n"
        "root.destroy()\n"
    )
    result = subprocess.run(
        [str(_picker_python()), "-c", script, payload],
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "Text prompt failed").strip()
        raise RuntimeError(detail)
    value = json.loads((result.stdout or '""').strip() or '""')
    return value or None


def _task_depth(indent: str) -> int:
    return indent.count("\t") + (len(indent.replace("\t", "")) // 4)


def _indent_for_depth(depth: int) -> str:
    return "    " * max(depth, 0)


def _format_task_line(indent: str, checked: bool, text: str) -> str:
    marker = "x" if checked else " "
    return f"{indent}- [{marker}] {text}"


def _read_note_lines(folder_path: str, relative_path: str) -> tuple[Path, str, list[str]]:
    target = resolve_note_file(folder_path, relative_path)
    original = target.read_text(encoding="utf-8")
    return target, original, original.splitlines()


def _assert_task_line(
    lines: list[str],
    line_index: int,
    expected_text: str | None = None,
) -> tuple[str, str, str, int]:
    if line_index < 0 or line_index >= len(lines):
        raise ValueError("Task line no longer exists")
    match = TASK_RE.match(lines[line_index])
    if not match:
        raise ValueError("Task line no longer matches a markdown task")
    indent, marker, text = match.groups()
    if expected_text is not None and text != expected_text:
        raise ValueError("Task line changed on disk")
    return indent, marker, text, _task_depth(indent)


def _find_task_block_end(lines: list[str], start_index: int) -> int:
    _, _, _, start_depth = _assert_task_line(lines, start_index)
    index = start_index + 1
    while index < len(lines):
        match = TASK_RE.match(lines[index])
        if match and _task_depth(match.group(1)) <= start_depth:
            break
        index += 1
    return index


def _find_previous_sibling_index(lines: list[str], line_index: int) -> int | None:
    _, _, _, depth = _assert_task_line(lines, line_index)
    scan = line_index - 1
    while scan >= 0:
        match = TASK_RE.match(lines[scan])
        if match:
            sibling_depth = _task_depth(match.group(1))
            if sibling_depth == depth:
                return scan
            if sibling_depth < depth:
                return None
        scan -= 1
    return None


def _find_next_sibling_index(lines: list[str], block_end: int, depth: int) -> int | None:
    scan = block_end
    while scan < len(lines):
        match = TASK_RE.match(lines[scan])
        if match:
            sibling_depth = _task_depth(match.group(1))
            if sibling_depth == depth:
                return scan
            if sibling_depth < depth:
                return None
        scan += 1
    return None


def _shift_block_depth(lines: list[str], start: int, end: int, delta: int) -> None:
    for index in range(start, end):
        match = TASK_RE.match(lines[index])
        if not match:
            continue
        indent, marker, text = match.groups()
        next_depth = _task_depth(indent) + delta
        if next_depth < 0:
            raise ValueError("Task is already at the top level")
        if next_depth > 8:
            raise ValueError("Maximum nesting reached")
        lines[index] = _format_task_line(_indent_for_depth(next_depth), marker.lower() == "x", text)


def _cleanup_stale_temp_files(target: Path) -> None:
    pattern = f"{target.name}.*.tmp"
    for path in target.parent.glob(pattern):
        try:
            if path.is_file():
                path.unlink()
        except OSError:
            pass


def _write_note_lines(target: Path, lines: list[str], original_text: str) -> None:
    keep_newline = original_text.endswith(("\n", "\r\n"))
    newline = "\r\n" if "\r\n" in original_text else "\n"
    output = newline.join(lines)
    if keep_newline or output:
        output += newline

    _cleanup_stale_temp_files(target)
    tmp_path = target.with_name(f"{target.name}.{os.getpid()}.tmp")
    last_error: OSError | None = None

    for attempt in range(6):
        try:
            tmp_path.write_text(output, encoding="utf-8")
            os.replace(tmp_path, target)
            return
        except OSError as exc:
            last_error = exc
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass
            if attempt < 5:
                time.sleep(0.05 * (2**attempt))
                continue
            break

    try:
        target.write_text(output, encoding="utf-8")
        return
    except OSError as exc:
        last_error = exc
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass

    if isinstance(last_error, PermissionError):
        raise ValueError(
            "Note file is locked. Close Obsidian or wait for iCloud sync, then try again."
        ) from last_error
    raise ValueError(f"Failed to write note file: {target.name}") from last_error


def add_task(
    folder_path: str,
    relative_path: str,
    text: str,
    after_line_index: int | None = None,
    depth: int = 0,
    insert_at: int | None = None,
) -> dict:
    target, original, lines = _read_note_lines(folder_path, relative_path)
    cleaned = text.strip()
    if not cleaned:
        raise ValueError("Task text is required")
    if depth < 0 or depth > 8:
        raise ValueError("Invalid task depth")

    new_line = f"{_indent_for_depth(depth)}- [ ] {cleaned}"
    if insert_at is not None:
        if insert_at < 0 or insert_at > len(lines):
            raise ValueError("Invalid insert position")
        lines.insert(insert_at, new_line)
    elif after_line_index is None or after_line_index < 0 or after_line_index >= len(lines):
        lines.append(new_line)
    else:
        lines.insert(after_line_index + 1, new_line)

    _write_note_lines(target, lines, original)
    return read_note_file(folder_path, relative_path)


def add_subtask(
    folder_path: str,
    relative_path: str,
    parent_line_index: int,
    text: str,
    expected_text: str | None = None,
) -> dict:
    target, original, lines = _read_note_lines(folder_path, relative_path)
    _, _, _, parent_depth = _assert_task_line(lines, parent_line_index, expected_text)
    insert_at = _find_task_block_end(lines, parent_line_index)
    cleaned = text.strip()
    if not cleaned:
        raise ValueError("Task text is required")
    if parent_depth + 1 > 8:
        raise ValueError("Maximum nesting reached")

    new_line = f"{_indent_for_depth(parent_depth + 1)}- [ ] {cleaned}"
    lines.insert(insert_at, new_line)
    _write_note_lines(target, lines, original)
    return read_note_file(folder_path, relative_path)


def move_task(
    folder_path: str,
    relative_path: str,
    line_index: int,
    direction: str,
    expected_text: str | None = None,
) -> dict:
    if direction not in {"up", "down"}:
        raise ValueError("Invalid move direction")

    target, original, lines = _read_note_lines(folder_path, relative_path)
    _, _, _, depth = _assert_task_line(lines, line_index, expected_text)
    block_start = line_index
    block_end = _find_task_block_end(lines, line_index)
    block = lines[block_start:block_end]

    if direction == "up":
        previous = _find_previous_sibling_index(lines, line_index)
        if previous is None:
            raise ValueError("Task is already at the top")
        previous_end = _find_task_block_end(lines, previous)
        previous_block = lines[previous:previous_end]
        lines = lines[:previous] + block + previous_block + lines[block_end:]
    else:
        next_index = _find_next_sibling_index(lines, block_end, depth)
        if next_index is None:
            raise ValueError("Task is already at the bottom")
        next_end = _find_task_block_end(lines, next_index)
        next_block = lines[next_index:next_end]
        lines = lines[:block_start] + next_block + block + lines[next_end:]

    _write_note_lines(target, lines, original)
    return read_note_file(folder_path, relative_path)


def indent_task(
    folder_path: str,
    relative_path: str,
    line_index: int,
    expected_text: str | None = None,
) -> dict:
    target, original, lines = _read_note_lines(folder_path, relative_path)
    _assert_task_line(lines, line_index, expected_text)

    previous_index = line_index - 1
    while previous_index >= 0 and not TASK_RE.match(lines[previous_index]):
        previous_index -= 1
    if previous_index < 0:
        raise ValueError("Cannot indent without a previous task")

    block_end = _find_task_block_end(lines, line_index)
    _shift_block_depth(lines, line_index, block_end, 1)
    _write_note_lines(target, lines, original)
    return read_note_file(folder_path, relative_path)


def outdent_task(
    folder_path: str,
    relative_path: str,
    line_index: int,
    expected_text: str | None = None,
) -> dict:
    target, original, lines = _read_note_lines(folder_path, relative_path)
    _, _, _, depth = _assert_task_line(lines, line_index, expected_text)
    if depth <= 0:
        raise ValueError("Task is already at the top level")

    block_end = _find_task_block_end(lines, line_index)
    _shift_block_depth(lines, line_index, block_end, -1)
    _write_note_lines(target, lines, original)
    return read_note_file(folder_path, relative_path)


def delete_task(
    folder_path: str,
    relative_path: str,
    line_index: int,
    expected_text: str | None = None,
) -> dict:
    target, original, lines = _read_note_lines(folder_path, relative_path)
    _assert_task_line(lines, line_index, expected_text)
    block_end = _find_task_block_end(lines, line_index)
    del lines[line_index:block_end]
    _write_note_lines(target, lines, original)
    return read_note_file(folder_path, relative_path)


def update_task_text(
    folder_path: str,
    relative_path: str,
    line_index: int,
    text: str,
    expected_text: str | None = None,
) -> dict:
    target, original, lines = _read_note_lines(folder_path, relative_path)
    cleaned = text.strip()
    if not cleaned:
        raise ValueError("Task text is required")

    indent, marker, task_text, _depth = _assert_task_line(lines, line_index, expected_text)
    lines[line_index] = _format_task_line(indent, marker.lower() == "x", cleaned)
    _write_note_lines(target, lines, original)
    return read_note_file(folder_path, relative_path)


def open_note_file_externally(folder_path: str, relative_path: str) -> None:
    target = resolve_note_file(folder_path, relative_path)
    if sys.platform == "win32":
        os.startfile(target)
        return
    raise OSError("Opening notes externally is only supported on Windows")


def get_notes_config() -> dict:
    enabled = notes_enabled_from_value(os.getenv("NOTES_ENABLED", "0"))
    folder_path = os.getenv("NOTES_FOLDER_PATH", "").strip()
    return {
        "enabled": enabled,
        "folderPath": folder_path,
    }


def list_markdown_files(folder_path: str) -> list[dict]:
    root = normalize_notes_root(folder_path)
    files: list[NoteFile] = []
    for path in root.rglob("*.md"):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        files.append(NoteFile(path=rel, name=rel))
    return [asdict(item) for item in sorted(files, key=lambda item: item.path.lower())]


def resolve_note_file(folder_path: str, relative_path: str) -> Path:
    if not relative_path or Path(relative_path).is_absolute():
        raise ValueError("Invalid notes file path")

    root = normalize_notes_root(folder_path)
    target = (root / relative_path).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError("Invalid notes file path") from exc

    if target.suffix.lower() != ".md":
        raise ValueError("Notes file must be a markdown file")
    if not target.exists() or not target.is_file():
        raise FileNotFoundError("Notes file not found")
    return target


def parse_markdown_tasks(text: str) -> list[dict]:
    tasks: list[NoteTask] = []
    for index, line in enumerate(text.splitlines()):
        match = TASK_RE.match(line)
        if not match:
            continue
        indent, marker, task_text = match.groups()
        depth = indent.count("\t") + (len(indent.replace("\t", "")) // 4)
        tasks.append(
            NoteTask(
                lineIndex=index,
                text=task_text,
                checked=marker.lower() == "x",
                depth=depth,
                raw=line,
            )
        )
    return [asdict(task) for task in tasks]


def read_note_file(folder_path: str, relative_path: str) -> dict:
    target = resolve_note_file(folder_path, relative_path)
    text = target.read_text(encoding="utf-8")
    return {
        "path": relative_path,
        "updatedAt": target.stat().st_mtime,
        "tasks": parse_markdown_tasks(text),
    }


def set_task_checked(
    folder_path: str,
    relative_path: str,
    line_index: int,
    checked: bool,
    expected_text: str | None = None,
) -> dict:
    target, original, lines = _read_note_lines(folder_path, relative_path)
    indent, _marker, task_text, _depth = _assert_task_line(lines, line_index, expected_text)
    lines[line_index] = _format_task_line(indent, checked, task_text)
    _write_note_lines(target, lines, original)
    return read_note_file(folder_path, relative_path)

import os
import re
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
    target = resolve_note_file(folder_path, relative_path)
    text = target.read_text(encoding="utf-8")
    keep_newline = text.endswith(("\n", "\r\n"))
    newline = "\r\n" if "\r\n" in text else "\n"
    lines = text.splitlines()

    if line_index < 0 or line_index >= len(lines):
        raise ValueError("Task line no longer exists")

    line = lines[line_index]
    match = TASK_RE.match(line)
    if not match:
        raise ValueError("Task line no longer matches a markdown task")

    indent, _marker, task_text = match.groups()
    if expected_text is not None and task_text != expected_text:
        raise ValueError("Task line changed on disk")
    marker = "x" if checked else " "
    lines[line_index] = f"{indent}- [{marker}] {task_text}"

    output = newline.join(lines)
    if keep_newline:
        output += "\n"

    tmp_path = target.with_name(f".{target.name}.tmp")
    tmp_path.write_text(output, encoding="utf-8")
    os.replace(tmp_path, target)

    return read_note_file(folder_path, relative_path)

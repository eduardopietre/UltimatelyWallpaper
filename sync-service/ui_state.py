import json
import os
from pathlib import Path

ALLOWED_UI_STATE_KEYS = frozenset(
    {
        "calendarCollapsed",
        "calendarPosition",
        "calendarPositionLocked",
        "calendarSize",
        "notesCollapsed",
        "notesHideCompleted",
        "notesPosition",
        "notesPositionLocked",
        "notesSelectedFile",
        "notesSize",
        "wallpaperPrefs",
        "gadgetVisibility",
        "launcherPosition",
        "clockPosition",
        "clockSize",
        "clockPrefs",
        "pomodoroPosition",
        "pomodoroPrefs",
        "linksPosition",
        "linksSize",
        "linksData",
        "mediaPosition",
        "mediaSize",
        "monitorPosition",
        "monitorSize",
    }
)


def ui_state_path(cache_dir: Path) -> Path:
    return cache_dir / "ui-state.json"


def read_ui_state(cache_dir: Path) -> dict[str, str]:
    path = ui_state_path(cache_dir)
    if not path.exists():
        return {}

    try:
        with open(path, encoding="utf-8") as handle:
            raw = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}

    if not isinstance(raw, dict):
        return {}

    values: dict[str, str] = {}
    for key, value in raw.items():
        if key not in ALLOWED_UI_STATE_KEYS:
            continue
        if value is None:
            continue
        values[key] = value if isinstance(value, str) else str(value)
    return values


def merge_ui_state(cache_dir: Path, updates: dict[str, str]) -> dict[str, str]:
    current = read_ui_state(cache_dir)
    for key, value in updates.items():
        if key not in ALLOWED_UI_STATE_KEYS:
            continue
        if value is None:
            current.pop(key, None)
            continue
        current[key] = value if isinstance(value, str) else str(value)

    cache_dir.mkdir(parents=True, exist_ok=True)
    path = ui_state_path(cache_dir)
    tmp_path = path.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(current, handle, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)
    return current

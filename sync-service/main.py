import logging
import os
import sys
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from cache import EventCache
from caldav_client import create_event, run_sync
from event_builder import CreateEventRequest, build_vevent_ical
from notes import (
    get_notes_config,
    list_markdown_files,
    notes_enabled_from_value,
    normalize_notes_root,
    read_note_file,
    set_task_checked,
)

BASE_DIR = Path(__file__).resolve().parent
LOG_DIR = BASE_DIR / "logs"
ENV_PATH = BASE_DIR / ".env"

load_dotenv(ENV_PATH)


def resolve_host() -> str:
    host = os.getenv("HOST", "127.0.0.1").strip()
    if host.lower() == "localhost":
        return "127.0.0.1"
    return host


def configure_logging() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    cutoff = datetime.now() - timedelta(days=7)
    for path in LOG_DIR.glob("*.log*"):
        try:
            modified = datetime.fromtimestamp(path.stat().st_mtime)
            if modified < cutoff:
                path.unlink()
        except OSError:
            pass

    root = logging.getLogger()
    root.setLevel(logging.INFO)

    for handler in list(root.handlers):
        root.removeHandler(handler)

    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    file_handler = TimedRotatingFileHandler(
        LOG_DIR / "sync-service.log",
        when="midnight",
        interval=1,
        backupCount=7,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(logging.INFO)
    root.addHandler(file_handler)

    if not sys.executable.lower().endswith("pythonw.exe"):
        console_handler = logging.StreamHandler()
        console_handler.setFormatter(formatter)
        console_handler.setLevel(logging.INFO)
        root.addHandler(console_handler)


configure_logging()
logger = logging.getLogger(__name__)

cache = EventCache(directory=os.getenv("CACHE_DIR", "cache"))
last_sync_error: str | None = None
scheduler = BackgroundScheduler()


class SettingsRequest(BaseModel):
    appleId: str = Field(min_length=1)
    appPassword: str | None = None
    syncIntervalMinutes: int = Field(gt=0)
    notesEnabled: bool = False
    notesFolderPath: str | None = None


class ToggleNoteTaskRequest(BaseModel):
    path: str = Field(min_length=1)
    lineIndex: int = Field(ge=0)
    checked: bool
    expectedText: str | None = None


def get_sync_interval_minutes() -> int:
    try:
        return int(os.getenv("SYNC_INTERVAL_MINUTES", "10"))
    except ValueError:
        return 10


def read_env_file() -> dict[str, str]:
    values: dict[str, str] = {}
    if not ENV_PATH.exists():
        return values

    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def write_env_values(updates: dict[str, str]) -> None:
    existing_lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.exists() else []
    seen: set[str] = set()
    output: list[str] = []

    for line in existing_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            output.append(line)
            continue

        key = line.split("=", 1)[0].strip()
        if key in updates:
            output.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            output.append(line)

    for key, value in updates.items():
        if key not in seen:
            output.append(f"{key}={value}")

    tmp_path = ENV_PATH.with_suffix(".tmp")
    tmp_path.write_text("\n".join(output) + "\n", encoding="utf-8")
    os.replace(tmp_path, ENV_PATH)


def apply_settings_to_environment(updates: dict[str, str]) -> None:
    for key, value in updates.items():
        os.environ[key] = value


def configure_sync_job(interval_minutes: int) -> None:
    if scheduler.get_job("icloud_sync"):
        scheduler.reschedule_job("icloud_sync", trigger="interval", minutes=interval_minutes)
        logger.info("Sync job rescheduled to every %d minute(s)", interval_minutes)
        return

    scheduler.add_job(
        scheduled_sync,
        "interval",
        minutes=interval_minutes,
        id="icloud_sync",
        replace_existing=True,
    )
    logger.info("Sync job configured to run every %d minute(s)", interval_minutes)


def scheduled_sync() -> bool:
    global last_sync_error
    try:
        run_sync(cache)
        last_sync_error = None
        return True
    except Exception as exc:
        last_sync_error = str(exc)
        logger.error("Sync failed: %s", exc)
        return False


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Sync service initialization started")
    configure_sync_job(get_sync_interval_minutes())
    scheduler.start()

    def run_initial_sync() -> None:
        try:
            if scheduled_sync():
                logger.info("Initial sync completed successfully")
            else:
                logger.warning("Initial sync failed: %s", last_sync_error)
        except Exception as exc:
            logger.warning("Initial sync failed: %s", exc)

    threading.Thread(target=run_initial_sync, name="initial-sync", daemon=True).start()
    logger.info("Sync service ready")
    yield
    logger.info("Sync service shutdown started")
    scheduler.shutdown(wait=False)
    logger.info("Sync service shutdown completed")


app = FastAPI(title="iCloud Calendar Sync", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    meta = cache.metadata()
    return {
        "status": "ok" if last_sync_error is None else "degraded",
        "lastSync": meta.get("updatedAt") if meta else None,
        "error": last_sync_error,
    }


@app.get("/settings")
def settings():
    values = read_env_file()
    apple_id = values.get("APPLE_ID", os.getenv("APPLE_ID", ""))
    app_password = values.get("APP_PASSWORD", os.getenv("APP_PASSWORD", ""))
    raw_interval = values.get("SYNC_INTERVAL_MINUTES", os.getenv("SYNC_INTERVAL_MINUTES", "10"))
    notes_enabled = notes_enabled_from_value(values.get("NOTES_ENABLED", os.getenv("NOTES_ENABLED", "0")))
    notes_folder_path = values.get("NOTES_FOLDER_PATH", os.getenv("NOTES_FOLDER_PATH", ""))
    try:
        interval = int(raw_interval)
    except ValueError:
        interval = 10

    return {
        "appleId": apple_id,
        "syncIntervalMinutes": interval,
        "hasAppPassword": bool(app_password),
        "notesEnabled": notes_enabled,
        "notesFolderPath": notes_folder_path,
    }


@app.post("/settings")
def update_settings(body: SettingsRequest):
    apple_id = body.appleId.strip()
    if not apple_id:
        raise HTTPException(status_code=400, detail="APPLE_ID is required")

    notes_folder_path = (body.notesFolderPath or "").strip()
    if body.notesEnabled:
        try:
            normalize_notes_root(notes_folder_path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    updates = {
        "APPLE_ID": apple_id,
        "SYNC_INTERVAL_MINUTES": str(body.syncIntervalMinutes),
        "NOTES_ENABLED": "1" if body.notesEnabled else "0",
        "NOTES_FOLDER_PATH": notes_folder_path,
    }
    if body.appPassword:
        updates["APP_PASSWORD"] = body.appPassword

    write_env_values(updates)
    apply_settings_to_environment(updates)
    configure_sync_job(body.syncIntervalMinutes)

    return {
        "status": "ok",
        "appleId": updates["APPLE_ID"],
        "syncIntervalMinutes": body.syncIntervalMinutes,
        "hasAppPassword": bool(os.getenv("APP_PASSWORD", "")),
        "notesEnabled": body.notesEnabled,
        "notesFolderPath": notes_folder_path,
    }


@app.get("/calendars")
def calendars():
    data = cache.read()
    if not data:
        return []
    return data.get("calendars", [])


@app.get("/events")
def events(
    from_date: datetime | None = Query(None, alias="from"),
    to_date: datetime | None = Query(None, alias="to"),
):
    data = cache.read()
    if not data:
        return {"updatedAt": None, "calendars": [], "events": []}

    all_events = data.get("events", [])
    if from_date is None and to_date is None:
        return data

    filtered = []
    for ev in all_events:
        start = datetime.fromisoformat(ev["start"].replace("Z", "+00:00"))
        if from_date and start < from_date.astimezone(timezone.utc):
            continue
        if to_date and start > to_date.astimezone(timezone.utc):
            continue
        filtered.append(ev)

    return {
        "updatedAt": data.get("updatedAt"),
        "calendars": data.get("calendars", []),
        "events": filtered,
    }


@app.get("/notes/files")
def notes_files():
    config = get_notes_config()
    if not config["enabled"]:
        return {**config, "files": []}
    if not config["folderPath"]:
        return {**config, "files": []}
    try:
        return {**config, "files": list_markdown_files(config["folderPath"])}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/notes/file")
def notes_file(path: str = Query(...)):
    config = get_notes_config()
    if not config["enabled"]:
        raise HTTPException(status_code=404, detail="Notes are disabled")
    try:
        return read_note_file(config["folderPath"], path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/notes/task")
def toggle_note_task(body: ToggleNoteTaskRequest):
    config = get_notes_config()
    if not config["enabled"]:
        raise HTTPException(status_code=404, detail="Notes are disabled")
    try:
        return set_task_checked(
            config["folderPath"],
            body.path,
            body.lineIndex,
            body.checked,
            body.expectedText,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/sync")
def sync_now():
    global last_sync_error
    try:
        payload = run_sync(cache)
        last_sync_error = None
        return {
            "status": "ok",
            "updatedAt": payload.updated_at,
        }
    except Exception as exc:
        last_sync_error = str(exc)
        logger.error("Manual sync failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/events")
def create_calendar_event(body: CreateEventRequest):
    global last_sync_error
    try:
        ical_data = build_vevent_ical(body)
        result = create_event(body.calendar_id, ical_data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        last_sync_error = str(exc)
        logger.error("Create event failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    sync_failed = False
    updated_at = None
    try:
        payload = run_sync(cache)
        last_sync_error = None
        updated_at = payload.updated_at
    except Exception as exc:
        sync_failed = True
        last_sync_error = str(exc)
        logger.warning("Event created but cache sync failed: %s", exc)

    return {
        "status": "ok",
        "event": result,
        "updatedAt": updated_at,
        "syncFailed": sync_failed,
    }


if __name__ == "__main__":
    import uvicorn

    host = resolve_host()
    port = int(os.getenv("PORT", "8765"))
    logger.info("Starting sync service directly on http://%s:%d", host, port)
    uvicorn.run(app, host=host, port=port, reload=False)

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from models import SyncPayload


class EventCache:
    def __init__(self, directory: str = "cache") -> None:
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.events_path = self.directory / "events.json"
        self.metadata_path = self.directory / "metadata.json"

    def write(self, payload: SyncPayload) -> None:
        data = payload.to_dict()
        tmp_events = self.events_path.with_suffix(".tmp")
        tmp_meta = self.metadata_path.with_suffix(".tmp")

        with open(tmp_events, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        metadata = {
            "updatedAt": payload.updated_at,
            "eventCount": len(payload.events),
            "calendarCount": len(payload.calendars),
        }
        with open(tmp_meta, "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)

        os.replace(tmp_events, self.events_path)
        os.replace(tmp_meta, self.metadata_path)

    def read(self) -> dict | None:
        if not self.events_path.exists():
            return None
        with open(self.events_path, encoding="utf-8") as f:
            return json.load(f)

    def metadata(self) -> dict | None:
        if not self.metadata_path.exists():
            return None
        with open(self.metadata_path, encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def utc_now_iso() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

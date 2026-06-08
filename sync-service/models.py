from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class CalendarInfo:
    id: str
    name: str
    color: str = "#3a588e"


@dataclass
class EventInfo:
    id: str
    title: str
    start: str
    end: str
    all_day: bool
    location: str
    calendar: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "start": self.start,
            "end": self.end,
            "allDay": self.all_day,
            "location": self.location,
            "calendar": self.calendar,
        }


@dataclass
class SyncPayload:
    updated_at: str
    calendars: list[CalendarInfo]
    events: list[EventInfo]

    def to_dict(self) -> dict[str, Any]:
        return {
            "updatedAt": self.updated_at,
            "calendars": [asdict(c) for c in self.calendars],
            "events": [e.to_dict() for e in self.events],
        }

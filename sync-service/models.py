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
    calendar_id: str = ""
    uid: str = ""
    description: str = ""
    url: str = ""
    is_recurring: bool = False
    recurrence_id: str = ""
    calendar_color: str = "#3a588e"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "start": self.start,
            "end": self.end,
            "allDay": self.all_day,
            "location": self.location,
            "calendar": self.calendar,
            "calendarId": self.calendar_id,
            "uid": self.uid,
            "description": self.description,
            "url": self.url,
            "isRecurring": self.is_recurring,
            "recurrenceId": self.recurrence_id,
            "calendarColor": self.calendar_color,
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

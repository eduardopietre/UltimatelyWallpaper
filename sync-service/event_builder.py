import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from icalendar import Alarm, Calendar, Event
from pydantic import BaseModel, field_validator, model_validator

RepeatOption = Literal["never", "daily", "weekly", "biweekly", "monthly", "yearly"]
AlertOption = Literal[
    "none",
    "at_time",
    "5m",
    "10m",
    "15m",
    "30m",
    "1h",
    "2h",
    "1d",
    "2d",
    "1w",
]

REPEAT_RRULE = {
    "daily": "FREQ=DAILY",
    "weekly": "FREQ=WEEKLY",
    "biweekly": "FREQ=WEEKLY;INTERVAL=2",
    "monthly": "FREQ=MONTHLY",
    "yearly": "FREQ=YEARLY",
}

ALERT_TRIGGER = {
    "at_time": "PT0S",
    "5m": "-PT5M",
    "10m": "-PT10M",
    "15m": "-PT15M",
    "30m": "-PT30M",
    "1h": "-PT1H",
    "2h": "-PT2H",
    "1d": "-P1D",
    "2d": "-P2D",
    "1w": "-P1W",
}


class CreateEventRequest(BaseModel):
    title: str
    location: str = ""
    all_day: bool = False
    start: str
    end: str
    repeat: RepeatOption = "never"
    alert: AlertOption = "none"
    url: str = ""
    notes: str = ""
    calendar_id: str

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Title is required")
        return cleaned

    @field_validator("calendar_id")
    @classmethod
    def calendar_id_not_empty(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Calendar is required")
        return cleaned

    @model_validator(mode="after")
    def validate_dates(self) -> "CreateEventRequest":
        start_dt = _parse_datetime(self.start, self.all_day)
        end_dt = _parse_datetime(self.end, self.all_day, is_end=True)
        if end_dt < start_dt:
            raise ValueError("End must be on or after start")
        return self


def _parse_datetime(value: str, all_day: bool, is_end: bool = False) -> datetime | date:
    if all_day:
        return date.fromisoformat(value[:10])
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        local_tz = datetime.now().astimezone().tzinfo
        dt = dt.replace(tzinfo=local_tz)
    return dt.astimezone(timezone.utc)


def build_vevent_ical(payload: CreateEventRequest) -> str:
    cal = Calendar()
    cal.add("prodid", "-//calendar-wallpaper//sync-service//EN")
    cal.add("version", "2.0")

    event = Event()
    event.add("uid", str(uuid.uuid4()))
    event.add("dtstamp", datetime.now(timezone.utc))
    event.add("summary", payload.title)
    if payload.location:
        event.add("location", payload.location)
    if payload.url:
        event.add("url", payload.url)
    if payload.notes:
        event.add("description", payload.notes)

    start_val = _parse_datetime(payload.start, payload.all_day)
    end_val = _parse_datetime(payload.end, payload.all_day, is_end=True)

    if payload.all_day:
        event.add("dtstart", start_val)
        if end_val <= start_val:
            end_val = start_val + timedelta(days=1)
        event.add("dtend", end_val)
    else:
        event.add("dtstart", start_val)
        event.add("dtend", end_val)

    if payload.repeat != "never":
        event.add("rrule", REPEAT_RRULE[payload.repeat])

    if payload.alert != "none":
        alarm = Alarm()
        alarm.add("action", "DISPLAY")
        alarm.add("description", payload.title)
        alarm.add("trigger", ALERT_TRIGGER[payload.alert])
        event.add_component(alarm)

    cal.add_component(event)
    return cal.to_ical().decode("utf-8")

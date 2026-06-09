from datetime import datetime, timezone
from typing import Any

from icalendar import Calendar
from recurring_ical_events import of as recurring_of

from models import EventInfo


def _to_utc_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def expand_calendar(cal: Calendar, start: datetime, end: datetime) -> list[dict[str, Any]]:
    return list(recurring_of(cal).between(start, end))


def _recurrence_id_iso(occurrence: dict[str, Any]) -> str:
    recurrence_id = occurrence.get("RECURRENCE-ID")
    if recurrence_id is None:
        return ""
    rid_dt = recurrence_id.dt
    if isinstance(rid_dt, datetime):
        return _to_utc_iso(rid_dt)
    return datetime.combine(rid_dt, datetime.min.time(), tzinfo=timezone.utc).isoformat()


def normalize_occurrence(
    occurrence: dict[str, Any],
    calendar_id: str,
    calendar_name: str,
    index: int,
    calendar_color: str = "#3a588e",
) -> EventInfo | None:
    summary = str(occurrence.get("SUMMARY", "") or "Untitled").strip()
    dtstart = occurrence.get("DTSTART")
    dtend = occurrence.get("DTEND")

    if dtstart is None:
        return None

    start_dt = dtstart.dt
    all_day = not isinstance(start_dt, datetime)

    if all_day:
        start_iso = datetime.combine(start_dt, datetime.min.time(), tzinfo=timezone.utc).isoformat()
        if dtend is not None:
            end_dt = dtend.dt
            end_iso = datetime.combine(end_dt, datetime.min.time(), tzinfo=timezone.utc).isoformat()
        else:
            end_iso = start_iso
    else:
        start_iso = _to_utc_iso(start_dt)
        end_iso = _to_utc_iso(dtend.dt) if dtend is not None else start_iso

    uid = str(occurrence.get("UID", f"{calendar_id}-{index}"))
    location = str(occurrence.get("LOCATION", "") or "")
    description = str(occurrence.get("DESCRIPTION", "") or "").strip()
    url = str(occurrence.get("URL", "") or "").strip()
    is_recurring = occurrence.get("RRULE") is not None or occurrence.get("RECURRENCE-ID") is not None
    recurrence_id = _recurrence_id_iso(occurrence)

    return EventInfo(
        id=f"{calendar_id}:{uid}:{start_iso}",
        title=summary,
        start=start_iso,
        end=end_iso,
        all_day=all_day,
        location=location,
        calendar=calendar_name,
        calendar_id=calendar_id,
        uid=uid,
        description=description,
        url=url,
        is_recurring=is_recurring,
        recurrence_id=recurrence_id,
        calendar_color=calendar_color,
    )


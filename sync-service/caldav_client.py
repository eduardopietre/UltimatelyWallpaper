import logging
import os
import re
from datetime import date, datetime, timedelta, timezone

from caldav import get_davclient
from icalendar import Calendar

from cache import EventCache
from models import CalendarInfo, EventInfo, SyncPayload
from recurrence import expand_calendar, normalize_occurrence

logger = logging.getLogger(__name__)

ICLOUD_COLORS = [
    "#E97777", "#7F669D", "#898AA6", "#967E76", "#71ad4b",
    "#3a588e", "#d27e06", "#0464ec", "#af4c4c", "#5482d6",
]


class CalDavSync:
    def __init__(
        self,
        apple_id: str,
        app_password: str,
        url: str = "https://caldav.icloud.com/",
        days_past: int = 30,
        days_future: int = 180,
    ) -> None:
        self.apple_id = apple_id
        self.app_password = app_password
        self.url = url
        self.days_past = days_past
        self.days_future = days_future

    def _date_window(self) -> tuple[datetime, datetime]:
        now = datetime.now(timezone.utc)
        start = now - timedelta(days=self.days_past)
        end = now + timedelta(days=self.days_future)
        return start, end

    def _calendar_color(self, cal, idx: int) -> str:
        try:
            props = cal.get_properties()
            for key in ("calendar-color", "{http://apple.com/ns/ical/}calendar-color", "COLOR"):
                value = props.get(key)
                if value:
                    color = str(value).strip()
                    if re.match(r"^#[0-9A-Fa-f]{6}$", color):
                        return color
        except Exception:
            pass
        return ICLOUD_COLORS[idx % len(ICLOUD_COLORS)]

    def _fetch_calendar_events(
        self,
        cal,
        cal_id: str,
        cal_name: str,
        cal_color: str,
        start: datetime,
        end: datetime,
    ) -> list[EventInfo]:
        merged = Calendar()
        try:
            results = cal.search(start=start, end=end, event=True, expand=True)
        except Exception:
            results = cal.date_search(start, end)

        for item in results:
            data = item.data
            if isinstance(data, bytes):
                data = data.decode("utf-8", errors="replace")
            sub = Calendar.from_ical(data)
            for comp in sub.walk("VEVENT"):
                merged.add_component(comp)

        occurrences = expand_calendar(merged, start, end)
        events: list[EventInfo] = []
        for i, occ in enumerate(occurrences):
            event = normalize_occurrence(occ, cal_id, cal_name, i, cal_color)
            if event:
                events.append(event)
        return events

    def sync(self) -> SyncPayload:
        start, end = self._date_window()
        calendars: list[CalendarInfo] = []
        events: list[EventInfo] = []

        with get_davclient(
            url=self.url,
            username=self.apple_id,
            password=self.app_password,
        ) as client:
            principal = client.get_principal()
            cal_objects = principal.get_calendars()

            for idx, cal in enumerate(cal_objects):
                cal_id = str(cal.url).rstrip("/").split("/")[-1]
                cal_name = cal.name or cal_id
                color = self._calendar_color(cal, idx)
                calendars.append(CalendarInfo(id=cal_id, name=cal_name, color=color))

                try:
                    events.extend(self._fetch_calendar_events(cal, cal_id, cal_name, color, start, end))
                except Exception as exc:
                    logger.warning("Failed to fetch calendar %s: %s", cal_name, exc)

        events.sort(key=lambda e: e.start)
        return SyncPayload(
            updated_at=EventCache.utc_now_iso(),
            calendars=calendars,
            events=events,
        )


def run_sync(cache: EventCache) -> SyncPayload:
    apple_id = os.getenv("APPLE_ID", "")
    app_password = os.getenv("APP_PASSWORD", "")
    if not apple_id or not app_password:
        raise ValueError("APPLE_ID and APP_PASSWORD must be set in .env")

    days_past = int(os.getenv("DAYS_PAST", "30"))
    days_future = int(os.getenv("DAYS_FUTURE", "180"))
    url = os.getenv("CALDAV_URL", "https://caldav.icloud.com/")

    syncer = CalDavSync(
        apple_id=apple_id,
        app_password=app_password,
        url=url,
        days_past=days_past,
        days_future=days_future,
    )
    payload = syncer.sync()
    cache.write(payload)
    logger.info("Synced %d events from %d calendars", len(payload.events), len(payload.calendars))
    return payload


def create_event(calendar_id: str, ical_data: str) -> dict:
    apple_id = os.getenv("APPLE_ID", "")
    app_password = os.getenv("APP_PASSWORD", "")
    if not apple_id or not app_password:
        raise ValueError("APPLE_ID and APP_PASSWORD must be set in .env")

    url = os.getenv("CALDAV_URL", "https://caldav.icloud.com/")

    with get_davclient(
        url=url,
        username=apple_id,
        password=app_password,
    ) as client:
        principal = client.get_principal()
        cal_objects = principal.get_calendars()

        target = None
        for cal in cal_objects:
            cal_id = str(cal.url).rstrip("/").split("/")[-1]
            if cal_id == calendar_id:
                target = cal
                break

        if target is None:
            raise ValueError(f"Calendar not found: {calendar_id}")

        created = target.add_event(ical_data)
        return {
            "calendarId": calendar_id,
            "url": str(created.url) if created.url else None,
        }


def _get_calendar_by_id(client, calendar_id: str):
    principal = client.get_principal()
    for cal in principal.get_calendars():
        cal_id = str(cal.url).rstrip("/").split("/")[-1]
        if cal_id == calendar_id:
            return cal
    return None


def _find_event_by_uid(calendar, uid: str, recurrence_id: str | None = None):
    try:
        events = calendar.search(uid=uid, comp_class="VEVENT")
    except Exception:
        events = []

    if not events:
        return None

    if not recurrence_id:
        return events[0]

    for event in events:
        data = event.data
        if isinstance(data, bytes):
            data = data.decode("utf-8", errors="replace")
        cal = Calendar.from_ical(data)
        for comp in cal.walk("VEVENT"):
            rid = comp.get("RECURRENCE-ID")
            if rid is not None:
                return event
    return events[0]


def update_event(
    calendar_id: str,
    uid: str,
    ical_data: str,
    recurrence_id: str | None = None,
    scope: str = "series",
) -> dict:
    apple_id = os.getenv("APPLE_ID", "")
    app_password = os.getenv("APP_PASSWORD", "")
    if not apple_id or not app_password:
        raise ValueError("APPLE_ID and APP_PASSWORD must be set in .env")

    url = os.getenv("CALDAV_URL", "https://caldav.icloud.com/")

    with get_davclient(
        url=url,
        username=apple_id,
        password=app_password,
    ) as client:
        target = _get_calendar_by_id(client, calendar_id)
        if target is None:
            raise ValueError(f"Calendar not found: {calendar_id}")

        if scope == "this" and recurrence_id:
            target.add_event(ical_data)
            return {"calendarId": calendar_id, "scope": "this"}

        event = _find_event_by_uid(target, uid, recurrence_id if scope == "this" else None)
        if event is None:
            raise ValueError(f"Event not found: {uid}")

        event.data = ical_data
        event.save()
        return {
            "calendarId": calendar_id,
            "uid": uid,
            "url": str(event.url) if event.url else None,
        }


def delete_event(
    calendar_id: str,
    uid: str,
    recurrence_id: str | None = None,
    scope: str = "series",
) -> dict:
    apple_id = os.getenv("APPLE_ID", "")
    app_password = os.getenv("APP_PASSWORD", "")
    if not apple_id or not app_password:
        raise ValueError("APPLE_ID and APP_PASSWORD must be set in .env")

    url = os.getenv("CALDAV_URL", "https://caldav.icloud.com/")

    with get_davclient(
        url=url,
        username=apple_id,
        password=app_password,
    ) as client:
        target = _get_calendar_by_id(client, calendar_id)
        if target is None:
            raise ValueError(f"Calendar not found: {calendar_id}")

        event = _find_event_by_uid(target, uid, recurrence_id if scope == "this" else None)
        if event is None:
            raise ValueError(f"Event not found: {uid}")

        if scope == "this" and recurrence_id:
            data = event.data
            if isinstance(data, bytes):
                data = data.decode("utf-8", errors="replace")
            cal = Calendar.from_ical(data)
            for comp in list(cal.walk("VEVENT")):
                rid = comp.get("RECURRENCE-ID")
                if rid is not None:
                    cal.subcomponents.remove(comp)
                    break
            event.data = cal.to_ical()
            event.save()
            return {"calendarId": calendar_id, "uid": uid, "scope": "this"}

        event.delete()
        return {"calendarId": calendar_id, "uid": uid, "scope": scope}

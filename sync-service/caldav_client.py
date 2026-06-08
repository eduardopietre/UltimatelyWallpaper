import logging
import os
from datetime import datetime, timedelta, timezone

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

    def _fetch_calendar_events(
        self,
        cal,
        cal_id: str,
        cal_name: str,
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
            event = normalize_occurrence(occ, cal_id, cal_name, i)
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
                color = ICLOUD_COLORS[idx % len(ICLOUD_COLORS)]
                calendars.append(CalendarInfo(id=cal_id, name=cal_name, color=color))

                try:
                    events.extend(self._fetch_calendar_events(cal, cal_id, cal_name, start, end))
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

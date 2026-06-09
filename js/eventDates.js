function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function endOfDay(date) {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}

function parseEventRange(ev) {
    const start = new Date(ev.start);
    let end = new Date(ev.end || ev.start);

    if (ev.allDay && end > start) {
        end = new Date(end);
        end.setDate(end.getDate() - 1);
        if (end < start) end = new Date(start);
    }

    return { start, end };
}

function eventOccursOnDay(ev, date) {
    const dayStart = startOfDay(date);
    const dayEnd = endOfDay(date);
    const { start, end } = parseEventRange(ev);
    return start <= dayEnd && end >= dayStart;
}

function eventOccursInRange(ev, rangeStart, rangeEnd) {
    const { start, end } = parseEventRange(ev);
    return start <= rangeEnd && end >= rangeStart;
}

function formatEventTime(isoString, allDay) {
    if (allDay) return "All day";
    const d = new Date(isoString);
    const opts = AppConfig.use24Hour
        ? { hour: "2-digit", minute: "2-digit", hour12: false }
        : { hour: "numeric", minute: "2-digit", hour12: true };
    return d.toLocaleTimeString(undefined, opts);
}

function formatShortDate(date) {
    return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

function formatEventDateRange(ev) {
    const { start, end } = parseEventRange(ev);

    if (ev.allDay) {
        if (start.toDateString() === end.toDateString()) {
            return formatShortDate(start);
        }
        return `${formatShortDate(start)} - ${formatShortDate(end)}`;
    }

    const sameDay = start.toDateString() === end.toDateString();
    if (sameDay) {
        return `${formatShortDate(start)}, ${formatEventTime(ev.start, false)} - ${formatEventTime(ev.end, false)}`;
    }
    return `${formatShortDate(start)} ${formatEventTime(ev.start, false)} - ${formatShortDate(end)} ${formatEventTime(ev.end, false)}`;
}

function formatDuration(ev) {
    if (ev.allDay) {
        const { start, end } = parseEventRange(ev);
        const days = Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
        return days === 1 ? "1 day" : `${days} days`;
    }

    const start = new Date(ev.start);
    const end = new Date(ev.end || ev.start);
    const mins = Math.round((end - start) / 60000);
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    if (rem === 0) return hours === 1 ? "1 hour" : `${hours} hours`;
    return `${hours}h ${rem}m`;
}

function getEventColor(ev) {
    if (ev.calendarColor) return ev.calendarColor;
    const calendars = typeof getCalendars === "function" ? getCalendars() : [];
    const cal = calendars.find((c) => c.id === ev.calendarId);
    return cal?.color || "var(--accent-color, #3a588e)";
}

function findEventById(eventId) {
    const events = typeof getEvents === "function" ? getEvents() : [];
    return events.find((e) => e.id === eventId) || null;
}

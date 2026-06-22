let currentView = "month";
let displayMonth = new Date();

const WEEKDAY_LABELS_SUN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LABELS_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_VIEW_HOURS = { start: 6, end: 22 };

function getWeekdayLabels() {
    return AppConfig.weekStart === 1 ? WEEKDAY_LABELS_MON : WEEKDAY_LABELS_SUN;
}

function formatTime(isoString, allDay) {
    return formatEventTime(isoString, allDay);
}

function formatDateHeader(date) {
    return date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
    });
}

function sameDay(a, b) {
    return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
    );
}

function eventStartDate(event) {
    return new Date(event.start);
}

function eventsForDay(date) {
    return getEvents()
        .filter((e) => eventOccursOnDay(e, date))
        .sort((a, b) => new Date(a.start) - new Date(b.start));
}

function upcomingEvents(limitDays = 14) {
    const now = startOfDay(new Date());
    const end = new Date(now);
    end.setDate(end.getDate() + limitDays);
    end.setHours(23, 59, 59, 999);

    return getEvents()
        .filter((e) => eventOccursInRange(e, now, end))
        .sort((a, b) => new Date(a.start) - new Date(b.start));
}

function getViewEmptyMessage() {
    const state = typeof getCalendarLoadState === "function" ? getCalendarLoadState() : "ready";
    if (state === "loading") return "Loading events...";
    if (state === "no_credentials") return "Open Settings to connect iCloud";
    if (state === "error") {
        const err = typeof getCalendarLoadError === "function" ? getCalendarLoadError() : "";
        return err || "Could not load events";
    }
    return null;
}

function isSameMonth(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function changeMonth(delta) {
    displayMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth() + delta, 1);
    refreshCalendarData();
}

function goToToday() {
    displayMonth = new Date();
    refreshCalendarData();
}

function initMonthNav() {
    document.getElementById("month-prev")?.addEventListener("click", () => changeMonth(-1));
    document.getElementById("month-next")?.addEventListener("click", () => changeMonth(1));
    document.getElementById("month-today")?.addEventListener("click", goToToday);
}

function updateMonthNavVisibility() {
    const nav = document.getElementById("month-nav");
    const todayBtn = document.getElementById("month-today");
    if (nav) {
        nav.classList.toggle("hidden", currentView !== "month");
    }
    if (todayBtn) {
        todayBtn.classList.toggle("hidden", isSameMonth(displayMonth, new Date()));
    }
}

function attachDayCellHandlers(container) {
    container.querySelectorAll(".day-cell").forEach((cell) => {
        cell.addEventListener("click", (e) => {
            e.stopPropagation();
            const ts = cell.dataset.date;
            if (!ts || typeof openDayPanel !== "function") return;
            openDayPanel(new Date(parseInt(ts, 10)));
        });
    });

    container.querySelectorAll(".event-dot, .event-more").forEach((el) => {
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            const cell = el.closest(".day-cell");
            const ts = cell?.dataset.date;
            if (!ts || typeof openDayPanel !== "function") return;
            openDayPanel(new Date(parseInt(ts, 10)));
        });
    });
}

function attachEventItemHandlers(container) {
    container.querySelectorAll(".event-item[data-event-id]").forEach((el) => {
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = el.dataset.eventId;
            if (id && typeof openEventDetail === "function") {
                openEventDetail(id);
            }
        });
    });
}

function attachDaySlotHandlers(container) {
    container.querySelectorAll(".day-time-slot").forEach((slot) => {
        slot.addEventListener("click", () => {
            const hour = parseInt(slot.dataset.hour, 10);
            const today = new Date();
            today.setHours(hour, 0, 0, 0);
            if (typeof openEventForm === "function") {
                openEventForm({ startDate: today });
            }
        });
    });
}

function getMonthGridDates(year, month) {
    const first = new Date(year, month, 1);
    let startOffset = first.getDay();
    if (AppConfig.weekStart === 1) {
        startOffset = (startOffset + 6) % 7;
    }

    const gridStart = new Date(year, month, 1 - startOffset);
    const cells = [];
    for (let i = 0; i < 42; i++) {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + i);
        cells.push(d);
    }
    return cells;
}

function renderMonthView() {
    const container = document.getElementById("view-month");
    if (!container) return;

    const emptyMsg = getViewEmptyMessage();
    if (emptyMsg && !getEvents().length) {
        container.innerHTML = `<p class="empty-state">${escapeHtml(emptyMsg)}</p>`;
        return;
    }

    const y = displayMonth.getFullYear();
    const m = displayMonth.getMonth();
    const today = new Date();
    const cells = getMonthGridDates(y, m);

    let html = '<div class="month-grid">';
    for (const label of getWeekdayLabels()) {
        html += `<div class="weekday-label">${label}</div>`;
    }

    for (const date of cells) {
        const inMonth = date.getMonth() === m;
        const isToday = sameDay(date, today);
        const dayEvents = eventsForDay(date);
        const classes = ["day-cell"];
        if (!inMonth) classes.push("other-month");
        if (isToday) classes.push("today");

        html += `<div class="${classes.join(" ")}" data-date="${date.getTime()}">`;
        html += `<span class="day-number">${date.getDate()}</span>`;
        html += '<div class="day-events">';
        const shown = dayEvents.slice(0, 3);
        for (const ev of shown) {
            const color = getEventColor(ev);
            html += `<span class="event-dot" style="background:${escapeHtml(color)}" title="${escapeHtml(ev.title)}">${escapeHtml(ev.title)}</span>`;
        }
        if (dayEvents.length > 3) {
            html += `<span class="event-more">+${dayEvents.length - 3} more</span>`;
        }
        html += "</div></div>";
    }
    html += "</div>";
    container.innerHTML = html;
    attachDayCellHandlers(container);
}

function renderDayView() {
    const container = document.getElementById("view-day");
    if (!container) return;

    const emptyMsg = getViewEmptyMessage();
    const today = new Date();
    const events = eventsForDay(today);

    let html = '<div class="day-view-layout">';
    html += '<div class="day-time-slots">';
    for (let h = DAY_VIEW_HOURS.start; h <= DAY_VIEW_HOURS.end; h++) {
        const label = AppConfig.use24Hour
            ? `${h < 10 ? "0" : ""}${h}:00`
            : new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric", hour12: true });
        html += `<button type="button" class="day-time-slot" data-hour="${h}"><span class="day-time-label">${escapeHtml(label)}</span></button>`;
    }
    html += "</div>";

    html += '<div class="day-events-column">';
    if (!events.length) {
        const msg = emptyMsg || "No events today";
        html += `<p class="empty-state">${escapeHtml(msg)}</p>`;
    } else {
        html += '<div class="event-list">';
        for (const ev of events) {
            html += renderEventItem(ev, { clickable: true });
        }
        html += "</div>";
    }
    html += "</div></div>";

    container.innerHTML = html;
    attachEventItemHandlers(container);
    attachDaySlotHandlers(container);
}

function renderUpcomingView() {
    const container = document.getElementById("view-upcoming");
    if (!container) return;

    const emptyMsg = getViewEmptyMessage();
    const events = upcomingEvents();
    if (!events.length) {
        const msg = emptyMsg || "No upcoming events";
        container.innerHTML = `<p class="empty-state">${escapeHtml(msg)}</p>`;
        return;
    }

    let html = "";
    let lastDateKey = "";

    for (const ev of events) {
        const d = eventStartDate(ev);
        const key = d.toDateString();
        if (key !== lastDateKey) {
            html += `<div class="upcoming-date-header">${formatDateHeader(d)}</div>`;
            lastDateKey = key;
        }
        html += renderEventItem(ev, { clickable: true });
    }
    container.innerHTML = html;
    attachEventItemHandlers(container);
}

function renderEventItem(ev, options = {}) {
    const time = formatTime(ev.start, ev.allDay);
    const location = ev.location ? `<div class="event-meta">${escapeHtml(ev.location)}</div>` : "";
    const cal = ev.calendar ? `<div class="event-meta">${escapeHtml(ev.calendar)}</div>` : "";
    const color = getEventColor(ev);
    const clickable = options.clickable ? ' data-event-id="' + escapeHtml(ev.id) + '" role="button" tabindex="0"' : "";
    const clickableClass = options.clickable ? " event-item-clickable" : "";
    return `
        <div class="event-item${clickableClass}"${clickable} style="border-left-color: ${escapeHtml(color)}">
            <div class="event-time">${time}</div>
            <div class="event-details">
                <div class="event-title">${escapeHtml(ev.title)}</div>
                ${location}${cal}
            </div>
        </div>`;
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
}

function setView(view) {
    if (typeof isEventFormVisible === "function" && isEventFormVisible()) {
        closeEventForm();
    }
    if (typeof closeDayPanel === "function") closeDayPanel();
    if (typeof closeEventDetail === "function") closeEventDetail();
    currentView = view;
    syncViewDropdown(view);
    document.getElementById("view-month").classList.toggle("hidden", view !== "month");
    document.getElementById("view-day").classList.toggle("hidden", view !== "day");
    document.getElementById("view-upcoming").classList.toggle("hidden", view !== "upcoming");
    renderCurrentView();
}

function renderCurrentView() {
    updateHeaderTitle();
    updateMonthNavVisibility();
    if (typeof isEventFormVisible === "function" && isEventFormVisible()) {
        return;
    }
    if (currentView === "month") renderMonthView();
    else if (currentView === "day") renderDayView();
    else renderUpcomingView();
}

function updateHeaderTitle() {
    const el = document.getElementById("header-title");
    if (!el) return;

    if (currentView === "month") {
        el.textContent = capitalizeFirstLetter(displayMonth.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric"
        }));
    } else if (currentView === "day") {
        el.textContent = formatDateHeader(new Date());
    } else {
        el.textContent = "Upcoming Events";
    }
}

function syncViewDropdown(view) {
    const hidden = document.getElementById("view-mode");
    const trigger = document.getElementById("view-trigger");
    const wrap = document.getElementById("view-dropdown");
    if (hidden) hidden.value = view;
    if (wrap && typeof syncCustomSelectDisplay === "function") {
        syncCustomSelectDisplay(wrap, view);
    } else if (trigger) {
        trigger.textContent = view === "day" ? "Day" : view === "upcoming" ? "Upcoming" : "Month";
    }
    document.querySelectorAll("#view-list .custom-select-option").forEach((option) => {
        const active = option.dataset.value === view;
        option.classList.toggle("active", active);
        option.setAttribute("aria-selected", active ? "true" : "false");
    });
}

function capitalizeFirstLetter(text) {
    if (!text) return "";
    return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

function viewModeFromHostValue(value) {
    const index = Number(value);
    if (index === 1) return "day";
    if (index === 2) return "upcoming";
    return "month";
}

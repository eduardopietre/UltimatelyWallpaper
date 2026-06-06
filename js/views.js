let currentView = "month";
let displayMonth = new Date();

const WEEKDAY_LABELS_SUN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LABELS_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getWeekdayLabels() {
    return AppConfig.weekStart === 1 ? WEEKDAY_LABELS_MON : WEEKDAY_LABELS_SUN;
}

function formatTime(isoString, allDay) {
    if (allDay) return "All day";
    const d = new Date(isoString);
    const opts = AppConfig.use24Hour
        ? { hour: "2-digit", minute: "2-digit", hour12: false }
        : { hour: "numeric", minute: "2-digit", hour12: true };
    return d.toLocaleTimeString(undefined, opts);
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
        .filter((e) => sameDay(eventStartDate(e), date))
        .sort((a, b) => new Date(a.start) - new Date(b.start));
}

function upcomingEvents(limitDays = 14) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setDate(end.getDate() + limitDays);

    return getEvents()
        .filter((e) => {
            const start = eventStartDate(e);
            return start >= now && start <= end;
        })
        .sort((a, b) => new Date(a.start) - new Date(b.start));
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
            if (!ts || typeof openEventForm !== "function") return;
            const startDate = new Date(parseInt(ts, 10));
            openEventForm({ startDate });
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
            html += `<span class="event-dot" title="${escapeHtml(ev.title)}">${escapeHtml(ev.title)}</span>`;
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

    const today = new Date();
    const events = eventsForDay(today);

    if (!events.length) {
        container.innerHTML = '<p class="empty-state">No events today</p>';
        return;
    }

    let html = '<div class="event-list">';
    for (const ev of events) {
        html += renderEventItem(ev);
    }
    html += "</div>";
    container.innerHTML = html;
}

function renderUpcomingView() {
    const container = document.getElementById("view-upcoming");
    if (!container) return;

    const events = upcomingEvents();
    if (!events.length) {
        container.innerHTML = '<p class="empty-state">No upcoming events</p>';
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
        html += renderEventItem(ev);
    }
    container.innerHTML = html;
}

function renderEventItem(ev) {
    const time = formatTime(ev.start, ev.allDay);
    const location = ev.location ? `<div class="event-meta">${escapeHtml(ev.location)}</div>` : "";
    const cal = ev.calendar ? `<div class="event-meta">${escapeHtml(ev.calendar)}</div>` : "";
    return `
        <div class="event-item">
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
    currentView = view;
    const select = document.getElementById("view-select");
    if (select) select.value = view;
    document.querySelectorAll(".view-tab").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.view === view);
    });
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

function capitalizeFirstLetter(text) {
    if (!text) return "";
    return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

function viewModeFromWeValue(value) {
    if (value === "2") return "day";
    if (value === "3") return "upcoming";
    return "month";
}

function weValueFromViewMode(view) {
    if (view === "day") return "2";
    if (view === "upcoming") return "3";
    return "1";
}

let dayPanelDate = null;

function buildDayPanelDom() {
    if (document.getElementById("day-panel-host")) return;
    const host = document.createElement("div");
    host.id = "day-panel-host";
    host.className = "event-panel day-panel hidden";
    document.body.appendChild(host);
}

function closeDayPanel() {
    document.getElementById("day-panel-host")?.classList.add("hidden");
    dayPanelDate = null;
}

function openDayPanel(date) {
    buildDayPanelDom();
    const host = document.getElementById("day-panel-host");
    if (!host) return;

    dayPanelDate = new Date(date);
    const events = eventsForDay(dayPanelDate);

    const header = `
        <div class="event-panel-header">
            <h2 class="event-panel-title">${escapeHtml(formatDateHeader(dayPanelDate))}</h2>
            <button type="button" class="event-panel-close" id="day-panel-close" aria-label="Close">&times;</button>
        </div>`;

    let body = '<div class="day-panel-body">';
    if (!events.length) {
        body += '<p class="empty-state">No events</p>';
    } else {
        body += '<div class="event-list">';
        for (const ev of events) {
            body += renderEventItem(ev, { clickable: true });
        }
        body += "</div>";
    }
    body += `
        <div class="day-panel-actions">
            <button type="button" class="event-btn event-btn-primary" id="day-panel-add-event">+ Event</button>
        </div>
    </div>`;

    host.innerHTML = header + body;
    host.classList.remove("hidden");

    host.querySelector("#day-panel-close")?.addEventListener("click", closeDayPanel);
    host.querySelector("#day-panel-add-event")?.addEventListener("click", () => {
        closeDayPanel();
        if (typeof openEventForm === "function") {
            openEventForm({ startDate: dayPanelDate });
        }
    });

    attachEventItemHandlers(host);
}

function initDayPanel() {
    buildDayPanelDom();
}

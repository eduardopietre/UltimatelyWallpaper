let detailEventId = null;

function buildEventDetailDom() {
    if (document.getElementById("event-detail-host")) return;
    const host = document.createElement("div");
    host.id = "event-detail-host";
    host.className = "event-panel event-detail-panel hidden";
    document.body.appendChild(host);
}

function closeEventDetail() {
    document.getElementById("event-detail-host")?.classList.add("hidden");
    detailEventId = null;
}

function openEventDetail(eventId) {
    const ev = findEventById(eventId);
    if (!ev) return;

    buildEventDetailDom();
    const host = document.getElementById("event-detail-host");
    if (!host) return;

    detailEventId = eventId;
    const color = getEventColor(ev);
    const recurringBadge = ev.isRecurring
        ? '<span class="event-detail-badge">Recurring</span>'
        : "";

    const location = ev.location
        ? `<div class="event-detail-row"><span class="event-detail-label">Location</span><span>${escapeHtml(ev.location)}</span></div>`
        : "";

    let urlRow = "";
    if (ev.url) {
        const safeUrl = escapeHtml(ev.url);
        urlRow = `<div class="event-detail-row"><span class="event-detail-label">URL</span><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a></div>`;
    }

    const description = ev.description
        ? `<div class="event-detail-row event-detail-notes"><span class="event-detail-label">Notes</span><div class="event-detail-description">${escapeHtml(ev.description)}</div></div>`
        : "";

    host.innerHTML = `
        <div class="event-panel-header">
            <h2 class="event-panel-title">${escapeHtml(ev.title)} ${recurringBadge}</h2>
            <button type="button" class="event-panel-close" id="event-detail-close" aria-label="Close">${Icons.svg("close-small")}</button>
        </div>
        <div class="event-detail-body">
            <div class="event-detail-calendar" style="border-left-color: ${escapeHtml(color)}">
                ${escapeHtml(ev.calendar || "")}
            </div>
            <div class="event-detail-row"><span class="event-detail-label">When</span><span>${escapeHtml(formatEventDateRange(ev))}</span></div>
            <div class="event-detail-row"><span class="event-detail-label">Duration</span><span>${escapeHtml(formatDuration(ev))}</span></div>
            ${location}
            ${urlRow}
            ${description}
            <div class="event-detail-actions">
                <button type="button" class="event-btn event-btn-secondary event-btn-icon" id="event-detail-edit">${Icons.svg("pencil")}<span class="icon-label">Edit</span></button>
                <button type="button" class="event-btn event-btn-danger event-btn-icon" id="event-detail-delete">${Icons.svg("trash")}<span class="icon-label">Delete</span></button>
            </div>
        </div>`;

    host.classList.remove("hidden");

    host.querySelector("#event-detail-close")?.addEventListener("click", closeEventDetail);
    host.querySelector("#event-detail-edit")?.addEventListener("click", () => {
        closeEventDetail();
        if (typeof openEventFormForEdit === "function") {
            openEventFormForEdit(ev);
        }
    });
    host.querySelector("#event-detail-delete")?.addEventListener("click", () => {
        confirmDeleteEvent(ev);
    });
}

async function confirmDeleteEvent(ev) {
    let scope = "series";
    if (ev.isRecurring) {
        const choice = await showRecurringDeleteChoice({
            title: "Delete recurring event",
            eventTitle: ev.title || ""
        });
        if (!choice) return;
        scope = choice === "this" ? "this" : "series";
    } else {
        const ok = await showConfirm({
            title: "Delete event",
            message: `Delete "${ev.title}"?`,
            confirmLabel: "Delete",
            cancelLabel: "Cancel",
            danger: true
        });
        if (!ok) return;
    }

    try {
        await deleteEvent({
            calendar_id: ev.calendarId,
            uid: ev.uid,
            recurrence_id: ev.recurrenceId || "",
            scope
        });
        closeEventDetail();
        closeDayPanel();
        if (typeof updateSyncStatus === "function") {
            updateSyncStatus("Event deleted");
        }
    } catch (err) {
        await showAlert({
            title: "Delete failed",
            message: err.message || "Failed to delete event"
        });
    }
}

function initEventDetail() {
    buildEventDetailDom();
}

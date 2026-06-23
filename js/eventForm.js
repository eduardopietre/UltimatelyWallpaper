let eventFormOpen = false;
let eventFormBuilt = false;
let calendarPickIndex = 0;
let allDayEnabled = false;
let eventFormMode = "create";
let editingEvent = null;

const REPEAT_OPTIONS = [
    { value: "never", label: "Never" },
    { value: "daily", label: "Every Day" },
    { value: "weekly", label: "Week" },
    { value: "biweekly", label: "2 Weeks" },
    { value: "monthly", label: "Month" },
    { value: "yearly", label: "Year" }
];

const ALERT_OPTIONS = [
    { value: "none", label: "None" },
    { value: "at_time", label: "At time of event" },
    { value: "5m", label: "5 min before" },
    { value: "10m", label: "10 min before" },
    { value: "15m", label: "15 min before" },
    { value: "30m", label: "30 min before" },
    { value: "1h", label: "1 hour before" },
    { value: "2h", label: "2 hours before" },
    { value: "1d", label: "1 day before" },
    { value: "2d", label: "2 days before" },
    { value: "1w", label: "1 week before" }
];

function pad2(n) {
    return n < 10 ? "0" + n : String(n);
}

function toDateInputValue(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toTimeInputValue(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function parseDateText(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
    if (!match) {
        throw new Error("Invalid date, use YYYY-MM-DD");
    }
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    const date = new Date(year, month - 1, day);
    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        throw new Error("Invalid date, use YYYY-MM-DD");
    }
    return date;
}

function parseTimeText(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
    if (!match) {
        throw new Error("Invalid time, use HH:MM");
    }
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours > 23 || minutes > 59) {
        throw new Error("Invalid time, use HH:MM");
    }
    return { hours, minutes };
}

function defaultEndDate(startDate, allDay) {
    const end = new Date(startDate);
    if (allDay) {
        end.setDate(end.getDate() + 1);
    } else {
        end.setHours(end.getHours() + 1);
    }
    return end;
}

function setFieldValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value;
    const wrap = el.closest(".custom-select");
    if (wrap) {
        syncCustomSelectDisplay(wrap, value);
    }
}

function readFormValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : "";
}

function optionLabel(options, value) {
    const match = options.find((o) => o.value === value);
    return match ? match.label : value;
}

function syncCustomSelectDisplay(wrap, value) {
    const trigger = wrap.querySelector(".custom-select-trigger");
    const options = wrap._customSelectOptions;
    if (trigger && options) {
        trigger.textContent = optionLabel(options, value);
    }
    wrap.querySelectorAll(".custom-select-option").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.value === value);
    });
}

function closeAllCustomSelects(exceptWrap) {
    document.querySelectorAll(".custom-select.open").forEach((wrap) => {
        if (wrap === exceptWrap) return;
        wrap.classList.remove("open");
        wrap.querySelector(".custom-select-list")?.classList.add("hidden");
    });
}

function createCustomSelect(parent, labelText, fieldId, options, optionRenderer) {
    const wrap = document.createElement("div");
    wrap.className = "event-field custom-select";
    wrap._customSelectOptions = options;

    const label = document.createElement("span");
    label.textContent = labelText;

    const hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.id = fieldId;
    hidden.value = options[0].value;

    const control = document.createElement("div");
    control.className = "custom-select-control";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "custom-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const list = document.createElement("div");
    list.className = "custom-select-list hidden";
    list.setAttribute("role", "listbox");

    function setValue(value) {
        hidden.value = value;
        syncCustomSelectDisplay(wrap, value);
        if (fieldId === "event-calendar-id" && typeof onCalendarSelected === "function") {
            onCalendarSelected(value);
        }
    }

    for (const opt of options) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "custom-select-option";
        btn.dataset.value = opt.value;
        if (optionRenderer) {
            btn.innerHTML = optionRenderer(opt);
        } else {
            btn.textContent = opt.label;
        }
        btn.setAttribute("role", "option");
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            setValue(opt.value);
            list.classList.add("hidden");
            wrap.classList.remove("open");
            trigger.setAttribute("aria-expanded", "false");
        });
        list.appendChild(btn);
    }

    trigger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const willOpen = list.classList.contains("hidden");
        closeAllCustomSelects(wrap);
        if (willOpen) {
            list.classList.remove("hidden");
            wrap.classList.add("open");
            trigger.setAttribute("aria-expanded", "true");
        } else {
            list.classList.add("hidden");
            wrap.classList.remove("open");
            trigger.setAttribute("aria-expanded", "false");
        }
    });

    setValue(options[0].value);
    control.appendChild(trigger);
    control.appendChild(list);
    wrap.appendChild(label);
    wrap.appendChild(hidden);
    wrap.appendChild(control);
    parent.appendChild(wrap);
    return hidden;
}

function getCachedCalendars() {
    return typeof getCalendars === "function" ? getCalendars() : [];
}

function getCalendarOptions() {
    const calendars = getCachedCalendars();
    if (!calendars.length) {
        return [{ value: "", label: "No calendars (sync first)", color: "#888" }];
    }
    return calendars.map((c) => ({
        value: c.id,
        label: c.name || c.id,
        color: c.color || "#3a588e"
    }));
}

function getSelectedCalendar() {
    const calendars = getCachedCalendars();
    if (!calendars.length) return null;
    const selectedId = readFormValue("event-calendar-id");
    if (selectedId) {
        const found = calendars.find((c) => c.id === selectedId);
        if (found) return found;
    }
    if (calendarPickIndex >= calendars.length) calendarPickIndex = 0;
    if (calendarPickIndex < 0) calendarPickIndex = 0;
    return calendars[calendarPickIndex];
}

function onCalendarSelected(calendarId) {
    const calendars = getCachedCalendars();
    const idx = calendars.findIndex((c) => c.id === calendarId);
    if (idx >= 0) calendarPickIndex = idx;
    try {
        localStorage.setItem(AppConfig.lastCalendarIdKey, calendarId);
    } catch {
        /* ignore */
    }
}

function initCalendarPickerIndex() {
    const calendars = getCachedCalendars();
    if (!calendars.length) {
        calendarPickIndex = 0;
        return;
    }
    try {
        const stored = localStorage.getItem(AppConfig.lastCalendarIdKey);
        const idx = calendars.findIndex((c) => c.id === stored);
        calendarPickIndex = idx >= 0 ? idx : 0;
    } catch {
        calendarPickIndex = 0;
    }
}

function setAllDayMode(allDay) {
    allDayEnabled = allDay;
    const startTime = document.getElementById("event-start-time");
    const endTime = document.getElementById("event-end-time");
    const toggle = document.getElementById("event-all-day-btn");
    if (startTime) startTime.style.display = allDay ? "none" : "";
    if (endTime) endTime.style.display = allDay ? "none" : "";
    if (toggle) toggle.textContent = allDay ? "All day: Yes" : "All day: No";
}

function createField(parent, labelText, inputId, placeholder) {
    const wrap = document.createElement("div");
    wrap.className = "event-field";
    const label = document.createElement("span");
    label.textContent = labelText;
    const input = document.createElement("input");
    input.id = inputId;
    input.type = "text";
    input.autocomplete = "off";
    if (placeholder) input.placeholder = placeholder;
    wrap.appendChild(label);
    wrap.appendChild(input);
    parent.appendChild(wrap);
    return input;
}

function renderCalendarOption(opt) {
    const color = opt.color || "#3a588e";
    return `<span class="calendar-option"><span class="calendar-swatch" style="background:${color}"></span>${opt.label}</span>`;
}

function buildEventFormDom() {
    if (eventFormBuilt) return true;
    const host = document.getElementById("event-panel-host");
    if (!host) return false;

    const header = document.createElement("div");
    header.className = "event-panel-header";

    const title = document.createElement("h2");
    title.id = "event-panel-title";
    title.className = "event-panel-title";
    title.textContent = "New Event";

    const closeBtn = document.createElement("button");
    closeBtn.id = "event-close-btn";
    closeBtn.type = "button";
    closeBtn.className = "event-panel-close";
    Icons.set(closeBtn, "close-small");
    closeBtn.addEventListener("click", closeEventForm);

    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.id = "event-form";
    body.className = "event-form";

    createField(body, "Title", "event-title", "");
    createField(body, "Location or Video Call", "event-location", "");

    const allDayWrap = document.createElement("div");
    allDayWrap.className = "event-field";
    const allDayBtn = document.createElement("button");
    allDayBtn.id = "event-all-day-btn";
    allDayBtn.type = "button";
    allDayBtn.className = "event-option-btn";
    allDayBtn.textContent = "All day: No";
    allDayBtn.addEventListener("click", () => {
        setAllDayMode(!allDayEnabled);
        try {
            const startDate = parseDateText(readFormValue("event-start-date"));
            const end = defaultEndDate(startDate, allDayEnabled);
            setFieldValue("event-end-date", toDateInputValue(end));
            if (!allDayEnabled) {
                setFieldValue("event-end-time", toTimeInputValue(end));
            }
        } catch {
            /* ignore */
        }
    });
    allDayWrap.appendChild(allDayBtn);
    body.appendChild(allDayWrap);

    const dtRow = document.createElement("div");
    dtRow.className = "event-datetime-row";
    createField(dtRow, "Starts", "event-start-date", "YYYY-MM-DD");
    createField(dtRow, "", "event-start-time", "HH:MM");
    createField(dtRow, "Ends", "event-end-date", "YYYY-MM-DD");
    createField(dtRow, "", "event-end-time", "HH:MM");
    body.appendChild(dtRow);

    createCustomSelect(body, "Repeat", "event-repeat", REPEAT_OPTIONS);
    createCustomSelect(body, "Alert", "event-alert", ALERT_OPTIONS);
    createField(body, "URL", "event-url", "");
    createField(body, "Notes", "event-notes", "");

    const calOptions = getCalendarOptions();
    createCustomSelect(body, "Calendar", "event-calendar-id", calOptions, renderCalendarOption);

    const errorEl = document.createElement("p");
    errorEl.id = "event-form-error";
    errorEl.className = "event-form-error";
    body.appendChild(errorEl);

    const actions = document.createElement("div");
    actions.className = "event-form-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.id = "event-cancel-btn";
    cancelBtn.type = "button";
    cancelBtn.className = "event-btn event-btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", closeEventForm);
    const saveBtn = document.createElement("button");
    saveBtn.id = "event-save-btn";
    saveBtn.type = "button";
    saveBtn.className = "event-btn event-btn-primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => {
        submitEventForm().catch((err) => {
            const el = document.getElementById("event-form-error");
            if (el) el.textContent = formatApiError(err);
            saveBtn.disabled = false;
        });
    });
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    body.appendChild(actions);

    host.appendChild(header);
    host.appendChild(body);
    eventFormBuilt = true;
    return true;
}

function isEventFormVisible() {
    const host = document.getElementById("event-panel-host");
    return host && !host.classList.contains("hidden");
}

function setEventFormTitle(text) {
    const title = document.getElementById("event-panel-title");
    if (title) title.textContent = text;
}

function resetEventFormFields(startDate, startTime) {
    const start = startDate ? new Date(startDate) : new Date();
    if (!startDate) {
        start.setMinutes(0, 0, 0);
        start.setHours(start.getHours() + 1);
    } else if (startTime) {
        const { hours, minutes } = parseTimeText(startTime);
        start.setHours(hours, minutes, 0, 0);
    } else {
        start.setHours(9, 0, 0, 0);
    }
    const end = defaultEndDate(start, false);

    setAllDayMode(false);
    initCalendarPickerIndex();

    setFieldValue("event-title", "");
    setFieldValue("event-location", "");
    setFieldValue("event-url", "");
    setFieldValue("event-notes", "");
    setFieldValue("event-start-date", toDateInputValue(start));
    setFieldValue("event-start-time", toTimeInputValue(start));
    setFieldValue("event-end-date", toDateInputValue(end));
    setFieldValue("event-end-time", toTimeInputValue(end));
    setFieldValue("event-repeat", "never");
    setFieldValue("event-alert", "none");

    const cal = getSelectedCalendar();
    if (cal) setFieldValue("event-calendar-id", cal.id);

    const errorEl = document.getElementById("event-form-error");
    if (errorEl) errorEl.textContent = "";
}

function fillEventFormFromEvent(ev) {
    const start = new Date(ev.start);
    let end = new Date(ev.end || ev.start);
    if (ev.allDay && end > start) {
        end = new Date(end);
        end.setDate(end.getDate() - 1);
        if (end < start) end = new Date(start);
    }

    setAllDayMode(!!ev.allDay);
    setFieldValue("event-title", ev.title || "");
    setFieldValue("event-location", ev.location || "");
    setFieldValue("event-url", ev.url || "");
    setFieldValue("event-notes", ev.description || "");
    setFieldValue("event-start-date", toDateInputValue(start));
    setFieldValue("event-end-date", toDateInputValue(end));
    if (!ev.allDay) {
        setFieldValue("event-start-time", toTimeInputValue(start));
        setFieldValue("event-end-time", toTimeInputValue(end));
    }
    setFieldValue("event-repeat", "never");
    setFieldValue("event-alert", "none");
    if (ev.calendarId) setFieldValue("event-calendar-id", ev.calendarId);
}

function openEventForm({ startDate, startTime } = {}) {
    const host = document.getElementById("event-panel-host");
    if (!host) return;

    window.setTimeout(() => {
        try {
            if (!buildEventFormDom()) return;
            eventFormMode = "create";
            editingEvent = null;
            setEventFormTitle("New Event");
            resetEventFormFields(startDate, startTime);
            host.classList.remove("hidden");
            eventFormOpen = true;
        } catch (err) {
            console.error("openEventForm failed:", err);
            if (typeof updateSyncStatus === "function") {
                updateSyncStatus("Could not open event form");
            }
        }
    }, 0);
}

function openEventFormForEdit(ev) {
    const host = document.getElementById("event-panel-host");
    if (!host) return;

    window.setTimeout(() => {
        try {
            if (!buildEventFormDom()) return;
            eventFormMode = "edit";
            editingEvent = ev;
            setEventFormTitle("Edit Event");
            fillEventFormFromEvent(ev);
            host.classList.remove("hidden");
            eventFormOpen = true;
        } catch (err) {
            console.error("openEventFormForEdit failed:", err);
        }
    }, 0);
}

function closeEventForm() {
    closeAllCustomSelects();
    document.getElementById("event-panel-host")?.classList.add("hidden");
    eventFormOpen = false;
    eventFormMode = "create";
    editingEvent = null;
}

function buildEventPayload() {
    const title = readFormValue("event-title").trim();
    if (!title) {
        throw new Error("Title is required");
    }

    const startDate = parseDateText(readFormValue("event-start-date"));
    const endDate = parseDateText(readFormValue("event-end-date"));

    let start;
    let end;
    if (allDayEnabled) {
        start = toDateInputValue(startDate);
        end = toDateInputValue(endDate);
        if (end <= start) {
            end = toDateInputValue(defaultEndDate(startDate, true));
        }
    } else {
        const startTime = parseTimeText(readFormValue("event-start-time"));
        const endTime = parseTimeText(readFormValue("event-end-time"));
        start = `${toDateInputValue(startDate)}T${pad2(startTime.hours)}:${pad2(startTime.minutes)}:00`;
        end = `${toDateInputValue(endDate)}T${pad2(endTime.hours)}:${pad2(endTime.minutes)}:00`;
    }

    const startDt = allDayEnabled ? startDate : new Date(start);
    const endDt = allDayEnabled ? endDate : new Date(end);
    if (allDayEnabled) {
        if (endDt < startDt) {
            throw new Error("End date must be on or after start date");
        }
    } else if (endDt <= startDt) {
        throw new Error("End time must be after start time");
    }

    const cal = getSelectedCalendar();
    if (!cal || !cal.id) {
        throw new Error("No calendar available, run sync first");
    }

    try {
        localStorage.setItem(AppConfig.lastCalendarIdKey, cal.id);
    } catch {
        /* ignore */
    }

    const repeat = readFormValue("event-repeat") || "never";
    const alert = readFormValue("event-alert") || "none";

    const payload = {
        title,
        location: readFormValue("event-location").trim(),
        all_day: allDayEnabled,
        start,
        end,
        repeat,
        alert,
        url: readFormValue("event-url").trim(),
        notes: readFormValue("event-notes").trim(),
        calendar_id: cal.id
    };

    if (eventFormMode === "edit" && editingEvent) {
        payload.calendar_id = editingEvent.calendarId || cal.id;
        payload.uid = editingEvent.uid;
        payload.recurrence_id = editingEvent.recurrenceId || "";
        payload.scope = "series";
    }

    return payload;
}

function formatApiError(err) {
    if (!err) return "Failed to save event";
    if (typeof err.message === "string" && err.message) return err.message;
    return "Failed to save event";
}

async function submitEventForm() {
    const errorEl = document.getElementById("event-form-error");
    const saveBtn = document.getElementById("event-save-btn");
    if (saveBtn?.disabled) return;

    try {
        const payload = buildEventPayload();
        if (saveBtn) saveBtn.disabled = true;
        if (errorEl) errorEl.textContent = "";

        let result;
        if (eventFormMode === "edit") {
            result = await updateEvent(payload);
        } else {
            result = await createEvent(payload);
        }

        if (result?.syncFailed && typeof updateSyncStatus === "function") {
            updateSyncStatus("Event saved, sync cache update failed");
        } else if (result?.refreshFailed && typeof updateSyncStatus === "function") {
            updateSyncStatus("Event saved, calendar refresh failed");
        }
        closeEventForm();
    } catch (err) {
        if (errorEl) errorEl.textContent = formatApiError(err);
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

function rebuildCalendarSelect() {
    const existing = document.getElementById("event-calendar-id");
    if (!existing) return;
    const wrap = existing.closest(".custom-select");
    const parent = wrap?.parentElement;
    if (!wrap || !parent) return;

    const calOptions = getCalendarOptions();
    wrap.remove();
    createCustomSelect(parent, "Calendar", "event-calendar-id", calOptions, renderCalendarOption);
    initCalendarPickerIndex();
    const cal = getSelectedCalendar();
    if (cal) setFieldValue("event-calendar-id", cal.id);
}

function populateCalendarSelect() {
    if (!eventFormBuilt) return;
    rebuildCalendarSelect();
}

function initEventForm() {
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".custom-select")) {
            closeAllCustomSelects();
        }
    });

    const addBtn = document.getElementById("add-event-btn");
    if (addBtn) {
        addBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            openEventForm();
        });
    }
}

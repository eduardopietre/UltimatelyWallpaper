let calendarData = { updatedAt: null, calendars: [], events: [] };
let isOnline = true;
let syncInProgress = false;

function readCache() {
    try {
        const raw = localStorage.getItem(AppConfig.cacheKey);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function writeCache(data) {
    try {
        localStorage.setItem(AppConfig.cacheKey, JSON.stringify(data));
    } catch {
        /* quota exceeded */
    }
}

function filterEvents(events) {
    if (!AppConfig.calendarFilter.length) return events;
    const allowed = new Set(AppConfig.calendarFilter);
    return events.filter((e) => allowed.has(e.calendar));
}

function setOnlineStatus(online) {
    isOnline = online;
    const badge = document.getElementById("offline-badge");
    if (badge) {
        const show = !online && AppConfig.showOfflineBadge;
        badge.classList.toggle("hidden", !show);
    }
}

function updateSyncStatus(text) {
    const el = document.getElementById("sync-status");
    if (el) el.textContent = text;
}

function getFetchDateRange() {
    const month = typeof displayMonth !== "undefined" ? displayMonth : new Date();
    const y = month.getFullYear();
    const m = month.getMonth();
    const from = new Date(y, m, 1);
    from.setDate(from.getDate() - 7);
    const to = new Date(y, m + 1, 0);
    to.setDate(to.getDate() + 42);
    to.setHours(23, 59, 59, 999);
    return { from, to };
}

async function fetchEvents() {
    const base = getSyncBaseUrl();
    const { from, to } = getFetchDateRange();

    const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString()
    });

    const response = await fetch(`${base}/events?${params}`, {
        method: "GET",
        cache: "no-store"
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function fetchCalendars() {
    const base = getSyncBaseUrl();
    const response = await fetch(`${base}/calendars`, {
        method: "GET",
        cache: "no-store"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

function getCalendars() {
    return calendarData.calendars || [];
}

async function refreshCalendarData() {
    try {
        const data = await fetchEvents();
        calendarData = {
            updatedAt: data.updatedAt,
            calendars: data.calendars || [],
            events: filterEvents(data.events || [])
        };
        writeCache(calendarData);
        setOnlineStatus(true);
        const updated = calendarData.updatedAt
            ? new Date(calendarData.updatedAt).toLocaleString()
            : "just now";
        updateSyncStatus(`Last sync: ${updated}`);
        if (typeof renderCurrentView === "function") renderCurrentView();
        if (typeof populateCalendarSelect === "function") populateCalendarSelect();
        return true;
    } catch {
        const cached = readCache();
        if (cached) {
            calendarData = {
                updatedAt: cached.updatedAt,
                calendars: cached.calendars || [],
                events: filterEvents(cached.events || [])
            };
            if (typeof renderCurrentView === "function") renderCurrentView();
            if (typeof populateCalendarSelect === "function") populateCalendarSelect();
        }
        setOnlineStatus(false);
        updateSyncStatus("Using cached data — sync service unavailable");
        return false;
    }
}

async function triggerSync(buttonEl) {
    if (syncInProgress) return false;
    syncInProgress = true;
    if (buttonEl) buttonEl.disabled = true;
    updateSyncStatus("Syncing...");

    try {
        const base = getSyncBaseUrl();
        const response = await fetch(`${base}/sync`, {
            method: "POST",
            cache: "no-store"
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await refreshCalendarData();
        return true;
    } catch {
        updateSyncStatus("Sync failed — sync service unavailable");
        setOnlineStatus(false);
        return false;
    } finally {
        syncInProgress = false;
        if (buttonEl) buttonEl.disabled = false;
    }
}

function parseApiErrorDetail(data, status) {
    if (!data || !data.detail) {
        return `Sync service error (${status})`;
    }
    if (typeof data.detail === "string") {
        return data.detail;
    }
    if (Array.isArray(data.detail)) {
        return data.detail.map((item) => item.msg || String(item)).join("; ");
    }
    return JSON.stringify(data.detail);
}

async function parseJsonResponse(response) {
    try {
        const text = await response.text();
        if (!text) return {};
        return JSON.parse(text);
    } catch {
        return {};
    }
}

async function createEvent(payload) {
    const base = getSyncBaseUrl();
    let response;

    try {
        response = await fetch(`${base}/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            cache: "no-store"
        });
    } catch {
        throw new Error("Sync service unavailable — could not create event");
    }

    const data = await parseJsonResponse(response);
    if (!response.ok) {
        throw new Error(parseApiErrorDetail(data, response.status));
    }

    let refreshFailed = false;
    try {
        await refreshCalendarData();
    } catch {
        refreshFailed = true;
    }

    return { ...data, refreshFailed };
}

function getEvents() {
    return calendarData.events || [];
}

function startPolling() {
    refreshCalendarData();
    setInterval(refreshCalendarData, AppConfig.pollIntervalMs);
}

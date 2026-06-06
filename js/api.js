let calendarData = { updatedAt: null, calendars: [], events: [] };
let isOnline = true;

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

async function fetchEvents() {
    const base = getSyncBaseUrl();
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    const to = new Date(now);
    to.setDate(to.getDate() + 180);

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
        }
        setOnlineStatus(false);
        updateSyncStatus("Using cached data — sync service unavailable");
        return false;
    }
}

function getEvents() {
    return calendarData.events || [];
}

function startPolling() {
    refreshCalendarData();
    setInterval(refreshCalendarData, AppConfig.pollIntervalMs);
}

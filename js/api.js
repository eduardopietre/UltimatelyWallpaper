let calendarData = { updatedAt: null, calendars: [], events: [] };
let isOnline = true;
let syncInProgress = false;
let healthTimer = null;

function isWallpaperEngine() {
    return typeof window.wallpaperPropertyListener !== "undefined";
}

function syncRequest(url, options = {}) {
    const method = options.method || "GET";
    const headers = { "Cache-Control": "no-store", ...(options.headers || {}) };
    const body = options.body ?? null;
    const timeoutMs = options.timeoutMs || 10000;

    if (!isWallpaperEngine() && typeof fetch === "function" && !options.preferXhr) {
        return fetch(url, { method, headers, body, cache: "no-store" });
    }

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        xhr.timeout = timeoutMs;
        for (const [key, value] of Object.entries(headers)) {
            xhr.setRequestHeader(key, value);
        }
        xhr.onload = () => {
            resolve({
                ok: xhr.status >= 200 && xhr.status < 300,
                status: xhr.status,
                text: async () => xhr.responseText,
                json: async () => {
                    if (!xhr.responseText) return {};
                    return JSON.parse(xhr.responseText);
                }
            });
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.ontimeout = () => reject(new Error("Request timeout"));
        xhr.send(body);
    });
}

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

function updateHealthIndicator(online) {
    const dot = document.getElementById("sync-health-dot");
    if (!dot) return;
    dot.classList.toggle("online", online);
    dot.classList.toggle("offline", !online);
    const label = online ? "Sync service online" : "Sync service offline";
    dot.title = label;
    dot.setAttribute("aria-label", label);
}

async function checkSyncHealth(retries = 1) {
    const base = getSyncBaseUrl();
    for (let attempt = 0; attempt < retries; attempt += 1) {
        try {
            const response = await syncRequest(`${base}/health`, {
                method: "GET",
                timeoutMs: 5000
            });
            const online = response.ok;
            updateHealthIndicator(online);
            setOnlineStatus(online);
            return online;
        } catch {
            if (attempt < retries - 1) {
                await new Promise((resolve) => window.setTimeout(resolve, 1000));
                continue;
            }
        }
    }
    updateHealthIndicator(false);
    setOnlineStatus(false);
    return false;
}

function startHealthChecks() {
    checkSyncHealth(5);
    if (healthTimer) window.clearInterval(healthTimer);
    healthTimer = window.setInterval(() => checkSyncHealth(1), AppConfig.healthIntervalMs);
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

    const response = await syncRequest(`${base}/events?${params}`, {
        method: "GET"
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function fetchCalendars() {
    const base = getSyncBaseUrl();
    const response = await syncRequest(`${base}/calendars`, {
        method: "GET"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function fetchSyncSettings() {
    const base = getSyncBaseUrl();
    const response = await syncRequest(`${base}/settings`, {
        method: "GET"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function saveSyncSettings(payload) {
    const base = getSyncBaseUrl();
    const response = await syncRequest(`${base}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
        throw new Error(parseApiErrorDetail(data, response.status));
    }
    await checkSyncHealth();
    return data;
}

async function fetchNotesFiles() {
    const base = getSyncBaseUrl();
    const response = await syncRequest(`${base}/notes/files`, {
        method: "GET"
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
        throw new Error(parseApiErrorDetail(data, response.status));
    }
    return data;
}

async function fetchNoteFile(path) {
    const base = getSyncBaseUrl();
    const params = new URLSearchParams({ path });
    const response = await syncRequest(`${base}/notes/file?${params}`, {
        method: "GET"
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
        throw new Error(parseApiErrorDetail(data, response.status));
    }
    return data;
}

async function toggleNoteTask(path, lineIndex, checked, expectedText) {
    const base = getSyncBaseUrl();
    const response = await syncRequest(`${base}/notes/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, lineIndex, checked, expectedText })
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
        throw new Error(parseApiErrorDetail(data, response.status));
    }
    return data;
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
        updateSyncStatus("Using cached data, sync service unavailable");
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
        const response = await syncRequest(`${base}/sync`, {
            method: "POST"
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await checkSyncHealth();
        await refreshCalendarData();
        return true;
    } catch {
        const healthy = await checkSyncHealth();
        updateSyncStatus("Sync failed, sync service unavailable");
        if (!healthy) setOnlineStatus(false);
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
        response = await syncRequest(`${base}/events`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    } catch {
        throw new Error("Sync service unavailable, could not create event");
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
    startHealthChecks();
}

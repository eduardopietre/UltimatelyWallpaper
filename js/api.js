let calendarData = { updatedAt: null, calendars: [], events: [] };
let isOnline = true;
let syncHealthStatus = "offline";
let syncHealthError = null;
let syncInProgress = false;
let healthTimer = null;
let pollTimer = null;
let calendarLoadState = "loading";
let calendarLoadError = null;
let hasLoadedOnce = false;

function shouldPreferXhrTransport() {
    if (typeof isLivelyHostDetected === "function" && isLivelyHostDetected()) {
        return true;
    }
    const protocol = window.location.protocol;
    return protocol === "file:" || protocol === "null:";
}

function syncRequest(url, options = {}) {
    const method = options.method || "GET";
    const headers = { "Cache-Control": "no-store", ...(options.headers || {}) };
    const body = options.body ?? null;
    const timeoutMs = options.timeoutMs || 10000;

    if (!shouldPreferXhrTransport() && typeof fetch === "function" && !options.preferXhr) {
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
    const calendars = calendarData.calendars || [];
    const nameToId = new Map(calendars.map((c) => [c.name, c.id]));
    return events.filter((e) => {
        if (allowed.has(e.calendarId)) return true;
        if (allowed.has(e.calendar)) return true;
        const mappedId = nameToId.get(e.calendar);
        return mappedId ? allowed.has(mappedId) : false;
    });
}

function getCalendarLoadState() {
    return calendarLoadState;
}

function getCalendarLoadError() {
    return calendarLoadError;
}

function setOnlineStatus(online) {
    isOnline = online;
    if (typeof updateHealthIndicator === "function") {
        updateHealthIndicator(syncHealthStatus, syncHealthError);
    }
}

function updateSyncStatus(text) {
    const el = document.getElementById("sync-status");
    if (el) el.textContent = text;
}

function updateHealthIndicator(status, errorText) {
    const dot = document.getElementById("sync-health-dot");
    if (!dot) return;

    const hideWhenOffline = status === "offline" && !AppConfig.showOfflineBadge;
    dot.classList.toggle("hidden", hideWhenOffline);
    dot.classList.toggle("online", status === "ok");
    dot.classList.toggle("degraded", status === "degraded");
    dot.classList.toggle("offline", status === "offline");

    let label = "Sync service offline";
    if (status === "ok") label = "Sync healthy";
    else if (status === "degraded") {
        label = errorText ? `Sync degraded: ${errorText}` : "Sync degraded";
    }
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
            if (!response.ok) {
                syncHealthStatus = "offline";
                syncHealthError = null;
                updateHealthIndicator("offline");
                setOnlineStatus(false);
                return false;
            }
            const data = await response.json();
            syncHealthStatus = data.status === "degraded" ? "degraded" : "ok";
            syncHealthError = data.error || null;
            updateHealthIndicator(syncHealthStatus, syncHealthError);
            setOnlineStatus(true);
            if (typeof retryUiStateFromServiceIfNeeded === "function") {
                retryUiStateFromServiceIfNeeded();
            }
            return true;
        } catch {
            if (attempt < retries - 1) {
                await new Promise((resolve) => window.setTimeout(resolve, 1000));
                continue;
            }
        }
    }
    syncHealthStatus = "offline";
    syncHealthError = null;
    updateHealthIndicator("offline");
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

async function promptNoteText(title, prompt, initialValue = "") {
    const base = getSyncBaseUrl();
    const response = await syncRequest(`${base}/notes/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, prompt, initialValue }),
        timeoutMs: 120000
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
        throw new Error(parseApiErrorDetail(data, response.status));
    }
    return data;
}

async function addNoteTask(path, text, afterLineIndex = null) {
    const base = getSyncBaseUrl();
    const payload = { path, text };
    if (afterLineIndex !== null && afterLineIndex !== undefined) {
        payload.afterLineIndex = afterLineIndex;
    }
    const response = await syncRequest(`${base}/notes/task/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
        throw new Error(parseApiErrorDetail(data, response.status));
    }
    return data;
}

async function editNoteTask(path, lineIndex, text, expectedText = null) {
    const base = getSyncBaseUrl();
    const payload = { path, lineIndex, text };
    if (expectedText !== null && expectedText !== undefined) {
        payload.expectedText = expectedText;
    }
    const response = await syncRequest(`${base}/notes/task/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
        throw new Error(parseApiErrorDetail(data, response.status));
    }
    return data;
}

async function addNoteSubtask(path, parentLineIndex, text, expectedText = null) {
    const base = getSyncBaseUrl();
    const payload = { path, parentLineIndex, text };
    if (expectedText !== null && expectedText !== undefined) {
        payload.expectedText = expectedText;
    }
    const response = await syncRequest(`${base}/notes/task/subtask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
        throw new Error(parseApiErrorDetail(data, response.status));
    }
    return data;
}

async function noteTaskAction(path, lineIndex, action, expectedText = null) {
    const base = getSyncBaseUrl();
    const payload = { path, lineIndex, action };
    if (expectedText !== null && expectedText !== undefined) {
        payload.expectedText = expectedText;
    }
    const response = await syncRequest(`${base}/notes/task/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
        throw new Error(parseApiErrorDetail(data, response.status));
    }
    return data;
}

async function openNoteFile(path) {
    const base = getSyncBaseUrl();
    const response = await syncRequest(`${base}/notes/open-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path })
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
        throw new Error(parseApiErrorDetail(data, response.status));
    }
    return data;
}

async function pickNotesFolder(initialDir = "", title = "") {
    const base = getSyncBaseUrl();
    const payload = { initialDir };
    if (title) payload.title = title;
    const response = await syncRequest(`${base}/notes/pick-folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        timeoutMs: 120000
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
        throw new Error(parseApiErrorDetail(data, response.status));
    }
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
    if (!hasLoadedOnce) {
        calendarLoadState = "loading";
        if (typeof renderCurrentView === "function") renderCurrentView();
    }

    try {
        let settings = null;
        try {
            settings = await fetchSyncSettings();
            if (settings?.syncIntervalMinutes) {
                AppConfig.pollIntervalMs = settings.syncIntervalMinutes * 60 * 1000;
            }
        } catch {
            /* settings optional on refresh */
        }

        const data = await fetchEvents();
        calendarData = {
            updatedAt: data.updatedAt,
            calendars: data.calendars || [],
            events: filterEvents(data.events || [])
        };
        writeCache(calendarData);
        setOnlineStatus(true);
        hasLoadedOnce = true;

        if (settings && !settings.hasAppPassword) {
            calendarLoadState = "no_credentials";
        } else if (syncHealthStatus === "degraded") {
            calendarLoadState = calendarData.events.length ? "ready" : "error";
            calendarLoadError = syncHealthError || "Sync failed";
        } else {
            calendarLoadState = calendarData.events.length ? "ready" : "empty";
            calendarLoadError = null;
        }

        const updated = calendarData.updatedAt
            ? new Date(calendarData.updatedAt).toLocaleString()
            : "just now";
        let statusText = `Last sync: ${updated}`;
        if (syncHealthStatus === "degraded" && syncHealthError) {
            statusText += ` (${syncHealthError})`;
        }
        updateSyncStatus(statusText);
        if (typeof renderCurrentView === "function") renderCurrentView();
        if (typeof populateCalendarSelect === "function") populateCalendarSelect();
        if (typeof populateCalendarFilterSettings === "function") populateCalendarFilterSettings();
        return true;
    } catch (err) {
        const cached = readCache();
        hasLoadedOnce = true;
        if (cached) {
            calendarData = {
                updatedAt: cached.updatedAt,
                calendars: cached.calendars || [],
                events: filterEvents(cached.events || [])
            };
            calendarLoadState = calendarData.events.length ? "ready" : "empty";
            if (typeof renderCurrentView === "function") renderCurrentView();
            if (typeof populateCalendarSelect === "function") populateCalendarSelect();
            if (typeof populateCalendarFilterSettings === "function") populateCalendarFilterSettings();
        } else {
            calendarLoadState = "error";
            calendarLoadError = err?.message || "Sync service unavailable";
            if (typeof renderCurrentView === "function") renderCurrentView();
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

async function updateEvent(payload) {
    const base = getSyncBaseUrl();
    let response;

    try {
        response = await syncRequest(`${base}/events`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    } catch {
        throw new Error("Sync service unavailable, could not update event");
    }

    const data = await parseJsonResponse(response);
    if (!response.ok) {
        throw new Error(parseApiErrorDetail(data, response.status));
    }

    try {
        await refreshCalendarData();
    } catch {
        /* ignore */
    }

    return data;
}

async function deleteEvent(payload) {
    const base = getSyncBaseUrl();
    let response;

    try {
        response = await syncRequest(`${base}/events`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    } catch {
        throw new Error("Sync service unavailable, could not delete event");
    }

    const data = await parseJsonResponse(response);
    if (!response.ok) {
        throw new Error(parseApiErrorDetail(data, response.status));
    }

    try {
        await refreshCalendarData();
    } catch {
        /* ignore */
    }

    return data;
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

function restartPolling(intervalMs) {
    if (pollTimer) window.clearInterval(pollTimer);
    if (intervalMs) AppConfig.pollIntervalMs = intervalMs;
    pollTimer = window.setInterval(refreshCalendarData, AppConfig.pollIntervalMs);
}

function startPolling() {
    refreshCalendarData();
    restartPolling(AppConfig.pollIntervalMs);
    startHealthChecks();
}

let hostBackgroundInitialized = false;
let livelyHostDetected = false;
let hostPersistenceReady = false;
const pendingHostProperties = [];

function normalizeHostColor(value) {
    if (value === null || value === undefined) return "";
    const text = String(value).trim();
    if (!text) return "";
    return text.startsWith("#") ? text : `#${text}`;
}

function backgroundTypeFromHostValue(value) {
    const index = Number(value);
    return index === 1 ? "2" : "1";
}

function fontFromHostValue(value) {
    const fonts = [
        "Segoe UI, system-ui, sans-serif",
        "Segoe UI, sans-serif",
        "Consolas, monospace"
    ];
    const index = Number(value);
    return fonts[index] || fonts[0];
}

function applyHostProperty(name, value) {
    switch (name) {
        case "syncPort": {
            const port = parseInt(String(value), 10);
            if (isNaN(port) || port <= 0 || port === AppConfig.syncPort) break;
            AppConfig.syncPort = port;
            // Everything persisted lives behind this port, so a correction here
            // means the earlier ui-state fetch went to the wrong place.
            if (typeof retryUiStateFromServiceIfNeeded === "function") {
                retryUiStateFromServiceIfNeeded();
            }
            break;
        }
        case "showOfflineBadge":
            AppConfig.showOfflineBadge = Boolean(value);
            if (typeof updateHealthIndicator === "function") {
                updateHealthIndicator(syncHealthStatus, syncHealthError);
            }
            break;
        case "calendarFilter":
            AppConfig.calendarFilter = parseCalendarFilter(String(value || ""));
            if (typeof calendarData !== "undefined") {
                calendarData.events = filterEvents(calendarData.events || []);
            }
            break;
        case "calendarColor":
            AppConfig.calendarColor = normalizeHostColor(value);
            break;
        case "calendarAlpha":
            AppConfig.calendarAlpha = Number(value) / 100;
            break;
        case "accentColor":
            AppConfig.accentColor = normalizeHostColor(value);
            break;
        case "weekStart":
            AppConfig.weekStart = Number(value) === 1 ? 1 : 0;
            break;
        case "clockFormat":
            AppConfig.use24Hour = Boolean(value);
            break;
        case "fontChoice":
            AppConfig.fontFamily = fontFromHostValue(value);
            break;
        case "startCollapsed":
            if (readPersistentStorage(AppConfig.collapsedKey) !== null) break;
            AppConfig.startCollapsed = Boolean(value);
            if (typeof setCollapsed === "function") {
                setCollapsed(Boolean(value), false);
            }
            break;
        case "viewMode":
            AppConfig.defaultView = viewModeFromHostValue(value);
            if (typeof setView === "function") setView(AppConfig.defaultView);
            break;
        case "bgType":
            if (typeof hasSavedWallpaperPrefs === "function" && hasSavedWallpaperPrefs()) break;
            AppConfig.bgType = backgroundTypeFromHostValue(value);
            break;
        case "bgColor":
            if (typeof hasSavedWallpaperPrefs === "function" && hasSavedWallpaperPrefs()) break;
            AppConfig.bgColor = normalizeHostColor(value);
            break;
        case "bgBlur":
            AppConfig.bgBlur = Number(value) || 0;
            break;
        case "bgBrightness":
            AppConfig.bgBrightness = Number(value) || 100;
            break;
        default:
            return false;
    }
    return true;
}

function applyHostBackgroundProperties(values) {
    const localWallpaperSelected = typeof hasSavedWallpaperPrefs === "function"
        && hasSavedWallpaperPrefs();

    if (values.bgBlur !== undefined) AppConfig.bgBlur = values.bgBlur;
    if (values.bgBrightness !== undefined) AppConfig.bgBrightness = values.bgBrightness;

    if (localWallpaperSelected) {
        if (typeof loadWallpaperPrefs === "function") loadWallpaperPrefs();
        applyBackground();
        hostBackgroundInitialized = true;
        return;
    }

    if (values.bgType !== undefined) AppConfig.bgType = values.bgType;
    if (values.bgColor !== undefined) AppConfig.bgColor = values.bgColor;
    applyBackground();
    hostBackgroundInitialized = true;
}

function applyLivelyPropertyChange(name, value) {
    const backgroundKeys = new Set(["bgType", "bgColor", "bgBlur", "bgBrightness"]);
    const backgroundPatch = {};

    if (backgroundKeys.has(name)) {
        if (name === "bgType") backgroundPatch.bgType = backgroundTypeFromHostValue(value);
        if (name === "bgColor") backgroundPatch.bgColor = normalizeHostColor(value);
        if (name === "bgBlur") backgroundPatch.bgBlur = Number(value) || 0;
        if (name === "bgBrightness") backgroundPatch.bgBrightness = Number(value) || 100;
        applyHostBackgroundProperties(backgroundPatch);
    } else {
        applyHostProperty(name, value);
    }

    applyCalendarBackground();

    if (typeof renderCurrentView === "function") renderCurrentView();
    if (typeof updateClock === "function") updateClock();
}

function livelyPropertyListener(name, value) {
    livelyHostDetected = true;
    if (!hostPersistenceReady) {
        pendingHostProperties.push([name, value]);
        return;
    }
    applyLivelyPropertyChange(name, value);
}

/**
 * Apply queued host properties that persistence itself depends on, before the
 * persisted state is read. `syncPort` decides which service we talk to, so it
 * cannot wait behind the rest of the queue (those defer to persisted values and
 * must run after).
 */
function applyHostTransportProperties() {
    const deferred = [];
    for (const entry of pendingHostProperties) {
        if (entry[0] === "syncPort") {
            applyHostProperty(entry[0], entry[1]);
        } else {
            deferred.push(entry);
        }
    }
    pendingHostProperties.length = 0;
    pendingHostProperties.push(...deferred);
}

function markHostPersistenceReady() {
    hostPersistenceReady = true;
    const queued = pendingHostProperties.splice(0, pendingHostProperties.length);
    for (const [name, value] of queued) {
        applyLivelyPropertyChange(name, value);
    }
}

window.livelyPropertyListener = livelyPropertyListener;

function isLivelyHostDetected() {
    return livelyHostDetected;
}

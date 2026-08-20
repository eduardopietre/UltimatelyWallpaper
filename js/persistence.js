const PERSISTED_UI_KEYS = new Set([
    "calendarCollapsed",
    "calendarPosition",
    "calendarPositionLocked",
    "calendarSize",
    "notesCollapsed",
    "notesHideCompleted",
    "notesPosition",
    "notesPositionLocked",
    "notesSelectedFile",
    "notesSize",
    "wallpaperPrefs",
    "gadgetVisibility",
    "launcherPosition",
    "clockPosition",
    "clockSize",
    "clockPrefs",
    "pomodoroPosition",
    "pomodoroPrefs",
    "linksPosition",
    "linksSize",
    "linksData",
    "mediaPosition",
    "mediaSize",
    "monitorPosition",
    "monitorSize"
]);

const UI_STATE_DB_NAME = "calendar-wallpaper";
const UI_STATE_STORE_NAME = "ui-state";
const UI_STATE_RECORD_KEY = "current";
const UI_STATE_SERVICE_SAVE_MS = 500;
const UI_STATE_BOOTSTRAP_ATTEMPTS = 4;
const UI_STATE_BOOTSTRAP_TIMEOUT_MS = 4000;
const UI_STATE_BOOTSTRAP_RETRY_MS = 400;

let persistentUiStateValues = {};
let uiStateDatabase = null;
let uiStateSaveTimer = null;
let uiStateServiceSaveTimer = null;
let uiStateServiceSyncPromise = null;
let uiStateServiceContacted = false;
let uiStatePendingServiceFlush = false;
const uiStateDirtyKeys = new Set();

function openUiStateDatabase() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(new Error("IndexedDB unavailable"));
            return;
        }

        const request = window.indexedDB.open(UI_STATE_DB_NAME, 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(UI_STATE_STORE_NAME)) {
                request.result.createObjectStore(UI_STATE_STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function readUiStateRecord(database) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(UI_STATE_STORE_NAME, "readonly");
        const request = transaction.objectStore(UI_STATE_STORE_NAME).get(UI_STATE_RECORD_KEY);
        request.onsuccess = () => resolve(request.result || {});
        request.onerror = () => reject(request.error);
    });
}

function saveUiStateRecord() {
    if (!uiStateDatabase) return;
    const values = { ...persistentUiStateValues };
    try {
        const transaction = uiStateDatabase.transaction(UI_STATE_STORE_NAME, "readwrite");
        transaction.objectStore(UI_STATE_STORE_NAME).put(values, UI_STATE_RECORD_KEY);
    } catch {
        /* localStorage and sync-service remain available as fallbacks */
    }
}

function scheduleUiStateSave() {
    if (uiStateSaveTimer !== null) return;
    uiStateSaveTimer = window.setTimeout(() => {
        uiStateSaveTimer = null;
        saveUiStateRecord();
    }, 100);
}

function mirrorPersistentValuesToLocalStorage() {
    PERSISTED_UI_KEYS.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(persistentUiStateValues, key)) return;
        try {
            localStorage.setItem(key, persistentUiStateValues[key]);
        } catch {
            /* IndexedDB and sync-service hold the authoritative copy */
        }
    });
}

/**
 * Copy the sync-service snapshot over the in-memory values. Returns both
 * `applied` (the snapshot carried at least one known key, so the service holds
 * real state) and `changed` (a value actually differs from what we hold).
 * The two are distinct: an identical snapshot still proves the service is in
 * sync, which is what the upload gate and the retry path check.
 */
function applyRemoteUiStateValues(remoteValues) {
    if (!remoteValues || typeof remoteValues !== "object") {
        return { applied: false, changed: false };
    }

    let applied = false;
    let changed = false;
    PERSISTED_UI_KEYS.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(remoteValues, key)) return;
        applied = true;
        const nextValue = String(remoteValues[key]);
        if (persistentUiStateValues[key] !== nextValue) {
            persistentUiStateValues[key] = nextValue;
            changed = true;
        }
    });

    if (changed) {
        mirrorPersistentValuesToLocalStorage();
        saveUiStateRecord();
    }

    return { applied, changed };
}

function collectPersistedUiStateValues() {
    const values = {};
    PERSISTED_UI_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(persistentUiStateValues, key)) {
            values[key] = persistentUiStateValues[key];
        }
    });
    return values;
}

/**
 * Only the keys touched since the last successful upload. The service merges
 * what it receives, so sending the delta keeps a routine save (a drag, a toggle)
 * at a few hundred bytes even when `wallpaperPrefs` holds a multi-megabyte data
 * URI — the whole snapshot is heavy enough to hit request size limits.
 */
function collectDirtyUiStateValues() {
    const values = {};
    uiStateDirtyKeys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(persistentUiStateValues, key)) {
            values[key] = persistentUiStateValues[key];
        }
    });
    return values;
}

/**
 * Upload the current snapshot. Refuses to run before the service has answered
 * once: uploading first lets a cold start (empty IndexedDB, or the default
 * positions the layout code writes for itself) overwrite the state the service
 * still holds. Deferred uploads are replayed by retryUiStateFromServiceIfNeeded
 * as soon as contact succeeds.
 */
async function flushUiStateToService({ full = false } = {}) {
    if (typeof getSyncBaseUrl !== "function" || typeof syncRequest !== "function") {
        return false;
    }

    if (!uiStateServiceContacted) {
        uiStatePendingServiceFlush = true;
        return false;
    }

    const values = full ? collectPersistedUiStateValues() : collectDirtyUiStateValues();
    const sentKeys = Object.keys(values);
    if (!sentKeys.length) return false;

    try {
        const response = await syncRequest(`${getSyncBaseUrl()}/ui-state`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ values }),
            timeoutMs: 15000
        });
        if (!response.ok) return false;
        // The response echoes the merged snapshot; we already hold every value
        // we sent, so parsing it back would only cost a large JSON round-trip.
        sentKeys.forEach((key) => uiStateDirtyKeys.delete(key));
        return true;
    } catch {
        return false;
    }
}

function scheduleUiStateServiceSave() {
    if (uiStateServiceSaveTimer !== null) {
        window.clearTimeout(uiStateServiceSaveTimer);
    }
    uiStateServiceSaveTimer = window.setTimeout(() => {
        uiStateServiceSaveTimer = null;
        flushUiStateToService();
    }, UI_STATE_SERVICE_SAVE_MS);
}

/**
 * Runs on every successful health check. The service is a tray app that can
 * start after the wallpaper, so this is the path that restores the layout when
 * the boot fetch found nothing listening.
 */
async function retryUiStateFromServiceIfNeeded() {
    if (uiStateServiceContacted) {
        if (uiStatePendingServiceFlush) {
            uiStatePendingServiceFlush = false;
            await flushUiStateToService();
        }
        return false;
    }

    const result = await syncUiStateFromService();
    if (!uiStateServiceContacted) return false;
    uiStatePendingServiceFlush = false;

    if (result.applied) {
        reapplyPersistedLayout();
        return true;
    }

    await flushUiStateToService({ full: true });
    return false;
}

/**
 * Re-run every "read persisted state and apply it" path. Used when the service
 * hands us a snapshot after the UI already booted from local (or default)
 * values, so it has to cover every persisted surface, gadgets included.
 */
function reapplyPersistedLayout() {
    if (typeof loadWallpaperPrefs === "function") {
        loadWallpaperPrefs();
        if (typeof applyBackground === "function") applyBackground();
    }

    if (typeof reloadSavedPosition === "function") reloadSavedPosition();
    if (typeof reloadSavedCardSize === "function") reloadSavedCardSize();

    if (typeof setCollapsed === "function") {
        const stored = readPersistentStorage(AppConfig.collapsedKey);
        if (stored !== null) {
            setCollapsed(stored === "1", false);
        }
    }

    if (typeof reloadNotesLayout === "function") reloadNotesLayout();
    if (typeof reloadLauncherLayout === "function") reloadLauncherLayout();
    if (typeof Gadgets !== "undefined") Gadgets.reloadFromState();
}

async function syncUiStateFromService(timeoutMs = 5000) {
    if (typeof getSyncBaseUrl !== "function" || typeof syncRequest !== "function") {
        return { applied: false, changed: false };
    }

    try {
        const response = await syncRequest(`${getSyncBaseUrl()}/ui-state`, {
            method: "GET",
            timeoutMs
        });
        if (!response.ok) return { applied: false, changed: false };
        const data = await response.json();
        uiStateServiceContacted = true;
        return applyRemoteUiStateValues(data.values);
    } catch {
        return { applied: false, changed: false };
    }
}

function waitMs(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Poll the service briefly at boot. Lively can load the wallpaper before the
 * tray service is listening, and a refused localhost connection fails
 * immediately, so a few short attempts cost almost nothing and keep us from
 * booting with default positions we would then push over the saved layout.
 */
async function bootstrapUiStateFromService() {
    for (let attempt = 0; attempt < UI_STATE_BOOTSTRAP_ATTEMPTS; attempt += 1) {
        const result = await syncUiStateFromService(UI_STATE_BOOTSTRAP_TIMEOUT_MS);
        if (uiStateServiceContacted) return result;
        if (attempt < UI_STATE_BOOTSTRAP_ATTEMPTS - 1) {
            await waitMs(UI_STATE_BOOTSTRAP_RETRY_MS);
        }
    }
    return { applied: false, changed: false };
}

function writePersistentStorage(key, value) {
    const serialized = String(value);
    persistentUiStateValues[key] = serialized;
    try {
        localStorage.setItem(key, serialized);
    } catch {
        /* sync-service stores values that exceed browser quotas */
    }
    if (PERSISTED_UI_KEYS.has(key)) {
        uiStateDirtyKeys.add(key);
        scheduleUiStateSave();
        scheduleUiStateServiceSave();
    }
}

function readPersistentStorage(key) {
    if (Object.prototype.hasOwnProperty.call(persistentUiStateValues, key)) {
        return persistentUiStateValues[key];
    }
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

async function loadPersistentUiState() {
    try {
        uiStateDatabase = await openUiStateDatabase();
        const storedValues = await readUiStateRecord(uiStateDatabase);
        if (storedValues && typeof storedValues === "object") {
            persistentUiStateValues = storedValues;
        }
    } catch {
        uiStateDatabase = null;
    }

    let migratedLocalState = false;
    PERSISTED_UI_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(persistentUiStateValues, key)) return;
        try {
            const localValue = localStorage.getItem(key);
            if (localValue !== null) {
                persistentUiStateValues[key] = localValue;
                migratedLocalState = true;
            }
        } catch {
            /* No local fallback is available. */
        }
    });

    if (migratedLocalState) {
        saveUiStateRecord();
    }

    if (!uiStateServiceSyncPromise) {
        uiStateServiceSyncPromise = bootstrapUiStateFromService()
            .then((result) => {
                if (!result.applied && Object.keys(collectPersistedUiStateValues()).length) {
                    return flushUiStateToService({ full: true });
                }
                return result.applied;
            })
            .catch(() => false);
    }
    await uiStateServiceSyncPromise;
}

/**
 * Best-effort upload while the page is going away. `sendBeacon` survives the
 * teardown that aborts a pending fetch, which matters because Lively unloads
 * the wallpaper on display changes, sleep, and restarts.
 */
function flushUiStateOnUnload() {
    if (uiStateServiceSaveTimer !== null) {
        window.clearTimeout(uiStateServiceSaveTimer);
        uiStateServiceSaveTimer = null;
    }

    if (!uiStateServiceContacted || typeof getSyncBaseUrl !== "function") return;

    const values = collectDirtyUiStateValues();
    if (!Object.keys(values).length) return;

    try {
        if (navigator.sendBeacon) {
            const blob = new Blob([JSON.stringify({ values })], { type: "application/json" });
            navigator.sendBeacon(`${getSyncBaseUrl()}/ui-state`, blob);
        }
    } catch {
        /* the regular request below is the fallback */
    }
    // Fired alongside the beacon on purpose: the beacon reports "queued", not
    // "delivered", and the merge on the service side is idempotent.
    flushUiStateToService();
}

function initUiStatePersistenceHooks() {
    window.addEventListener("pagehide", flushUiStateOnUnload);
    window.addEventListener("beforeunload", flushUiStateOnUnload);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushUiStateOnUnload();
    });
}

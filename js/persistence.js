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
    "wallpaperPrefs"
]);

const UI_STATE_DB_NAME = "calendar-wallpaper";
const UI_STATE_STORE_NAME = "ui-state";
const UI_STATE_RECORD_KEY = "current";
const UI_STATE_SERVICE_SAVE_MS = 500;

let persistentUiStateValues = {};
let uiStateDatabase = null;
let uiStateSaveTimer = null;
let uiStateServiceSaveTimer = null;
let uiStateServiceSyncPromise = null;
let uiStateBootstrappedFromService = false;

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

function applyRemoteUiStateValues(remoteValues) {
    if (!remoteValues || typeof remoteValues !== "object") return false;

    let changed = false;
    PERSISTED_UI_KEYS.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(remoteValues, key)) return;
        const nextValue = String(remoteValues[key]);
        if (persistentUiStateValues[key] !== nextValue) {
            persistentUiStateValues[key] = nextValue;
            changed = true;
        }
    });

    if (!changed) return false;

    mirrorPersistentValuesToLocalStorage();
    saveUiStateRecord();
    return true;
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

async function flushUiStateToService() {
    if (typeof getSyncBaseUrl !== "function" || typeof syncRequest !== "function") {
        return false;
    }

    const values = collectPersistedUiStateValues();
    if (!Object.keys(values).length) return false;

    try {
        const response = await syncRequest(`${getSyncBaseUrl()}/ui-state`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ values }),
            timeoutMs: 15000
        });
        if (!response.ok) return false;
        const data = await response.json();
        applyRemoteUiStateValues(data.values);
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

async function retryUiStateFromServiceIfNeeded() {
    if (uiStateBootstrappedFromService) return false;
    const loaded = await syncUiStateFromService();
    if (!loaded) return false;
    uiStateBootstrappedFromService = true;
    reapplyPersistedLayout();
    return true;
}

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
}

async function syncUiStateFromService() {
    if (typeof getSyncBaseUrl !== "function" || typeof syncRequest !== "function") {
        return false;
    }

    try {
        const response = await syncRequest(`${getSyncBaseUrl()}/ui-state`, {
            method: "GET",
            timeoutMs: 5000
        });
        if (!response.ok) return false;
        const data = await response.json();
        const loaded = applyRemoteUiStateValues(data.values);
        if (loaded) uiStateBootstrappedFromService = true;
        return loaded;
    } catch {
        return false;
    }
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
        uiStateServiceSyncPromise = syncUiStateFromService()
            .then((loadedFromService) => {
                if (!loadedFromService && Object.keys(collectPersistedUiStateValues()).length) {
                    return flushUiStateToService();
                }
                return loadedFromService;
            })
            .catch(() => false);
    }
    await uiStateServiceSyncPromise;
}

function initUiStatePersistenceHooks() {
    window.addEventListener("pagehide", () => {
        if (uiStateServiceSaveTimer !== null) {
            window.clearTimeout(uiStateServiceSaveTimer);
            uiStateServiceSaveTimer = null;
        }
        flushUiStateToService();
    });
}

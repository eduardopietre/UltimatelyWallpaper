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

let persistentUiStateValues = {};
let uiStateDatabase = null;
let uiStateSaveTimer = null;

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
        /* localStorage remains the fallback if the browser database becomes unavailable. */
    }
}

function scheduleUiStateSave() {
    if (uiStateSaveTimer !== null) return;
    uiStateSaveTimer = window.setTimeout(() => {
        uiStateSaveTimer = null;
        saveUiStateRecord();
    }, 100);
}

function writePersistentStorage(key, value) {
    const serialized = String(value);
    persistentUiStateValues[key] = serialized;
    try {
        localStorage.setItem(key, serialized);
    } catch {
        /* IndexedDB supports values that exceed the localStorage quota. */
    }
    if (PERSISTED_UI_KEYS.has(key)) {
        scheduleUiStateSave();
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
}

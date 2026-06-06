let settingsPanelBuilt = false;

function createSettingsField(parent, labelText, inputId, type, placeholder) {
    const wrap = document.createElement("label");
    wrap.className = "settings-field";

    const label = document.createElement("span");
    label.textContent = labelText;

    const input = document.createElement("input");
    input.id = inputId;
    input.type = type;
    input.autocomplete = "off";
    if (placeholder) input.placeholder = placeholder;

    wrap.appendChild(label);
    wrap.appendChild(input);
    parent.appendChild(wrap);
    return input;
}

function buildSettingsPanelDom() {
    if (settingsPanelBuilt) return true;
    const host = document.getElementById("settings-panel-host");
    if (!host) return false;

    const header = document.createElement("div");
    header.className = "settings-panel-header";

    const title = document.createElement("h2");
    title.className = "settings-panel-title";
    title.textContent = "Settings";

    const closeBtn = document.createElement("button");
    closeBtn.id = "settings-close-btn";
    closeBtn.type = "button";
    closeBtn.className = "settings-panel-close";
    closeBtn.textContent = "x";
    closeBtn.addEventListener("click", closeSettingsPanel);

    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "settings-form";

    const bgActions = document.createElement("div");
    bgActions.className = "settings-section";
    const bgTitle = document.createElement("div");
    bgTitle.className = "settings-section-title";
    bgTitle.textContent = "Background";
    const bgButtons = document.createElement("div");
    bgButtons.className = "settings-actions";

    const wallpaperBtn = document.createElement("button");
    wallpaperBtn.id = "wallpaper-btn";
    wallpaperBtn.type = "button";
    wallpaperBtn.className = "settings-btn";
    wallpaperBtn.textContent = "Wallpaper";

    const solidBtn = document.createElement("button");
    solidBtn.id = "wallpaper-solid-btn";
    solidBtn.type = "button";
    solidBtn.className = "settings-btn";
    solidBtn.textContent = "Solid";

    bgButtons.appendChild(wallpaperBtn);
    bgButtons.appendChild(solidBtn);
    bgActions.appendChild(bgTitle);
    bgActions.appendChild(bgButtons);

    const syncSection = document.createElement("div");
    syncSection.className = "settings-section";
    const syncTitle = document.createElement("div");
    syncTitle.className = "settings-section-title";
    syncTitle.textContent = "iCloud Sync";
    syncSection.appendChild(syncTitle);

    createSettingsField(syncSection, "APPLE_ID", "settings-apple-id", "text", "your_apple_id@icloud.com");
    createSettingsField(syncSection, "APP_PASSWORD", "settings-app-password", "password", "Leave blank to keep existing password");
    createSettingsField(syncSection, "SYNC_INTERVAL_MINUTES", "settings-sync-interval", "number", "10");

    const hint = document.createElement("p");
    hint.id = "settings-password-hint";
    hint.className = "settings-hint";
    hint.textContent = "";
    syncSection.appendChild(hint);

    const error = document.createElement("p");
    error.id = "settings-error";
    error.className = "settings-error";
    body.appendChild(bgActions);
    body.appendChild(syncSection);
    body.appendChild(error);

    const footer = document.createElement("div");
    footer.className = "settings-footer";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "event-btn event-btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", closeSettingsPanel);

    const saveBtn = document.createElement("button");
    saveBtn.id = "settings-save-btn";
    saveBtn.type = "button";
    saveBtn.className = "event-btn event-btn-primary";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => {
        submitSettings().catch((err) => {
            showSettingsError(err.message || "Failed to save settings");
        });
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    body.appendChild(footer);

    host.appendChild(header);
    host.appendChild(body);
    settingsPanelBuilt = true;
    return true;
}

function showSettingsError(message) {
    const el = document.getElementById("settings-error");
    if (el) el.textContent = message || "";
}

function setSettingsFieldValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

async function loadSettingsIntoForm() {
    showSettingsError("");
    setSettingsFieldValue("settings-app-password", "");

    try {
        const settings = await fetchSyncSettings();
        setSettingsFieldValue("settings-apple-id", settings.appleId || "");
        setSettingsFieldValue("settings-sync-interval", String(settings.syncIntervalMinutes || 10));
        const hint = document.getElementById("settings-password-hint");
        if (hint) {
            hint.textContent = settings.hasAppPassword
                ? "Password is saved locally. Leave blank to keep it."
                : "No app password saved yet.";
        }
    } catch {
        showSettingsError("Sync service unavailable. Start it to edit iCloud settings.");
    }
}

function readSettingsPayload() {
    const appleId = document.getElementById("settings-apple-id")?.value.trim() || "";
    const appPassword = document.getElementById("settings-app-password")?.value || "";
    const rawInterval = document.getElementById("settings-sync-interval")?.value.trim() || "";
    const syncIntervalMinutes = Number(rawInterval);

    if (!appleId) {
        throw new Error("APPLE_ID is required");
    }
    if (!Number.isInteger(syncIntervalMinutes) || syncIntervalMinutes <= 0) {
        throw new Error("SYNC_INTERVAL_MINUTES must be a positive integer");
    }

    return { appleId, appPassword, syncIntervalMinutes };
}

async function submitSettings() {
    const saveBtn = document.getElementById("settings-save-btn");
    if (saveBtn?.disabled) return;

    try {
        if (saveBtn) saveBtn.disabled = true;
        showSettingsError("");
        const payload = readSettingsPayload();
        await saveSyncSettings(payload);
        setSettingsFieldValue("settings-app-password", "");
        updateSyncStatus("Settings saved");
        closeSettingsPanel();
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

function openSettingsPanel() {
    const host = document.getElementById("settings-panel-host");
    if (!host || !buildSettingsPanelDom()) return;
    host.classList.remove("hidden");
    loadSettingsIntoForm();
}

function closeSettingsPanel() {
    document.getElementById("settings-panel-host")?.classList.add("hidden");
}

function initSettingsPanel() {
    buildSettingsPanelDom();
    document.getElementById("settings-btn")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSettingsPanel();
    });
}

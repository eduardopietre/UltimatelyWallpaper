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

function createSettingsToggle(parent, labelText, inputId) {
    const wrap = document.createElement("label");
    wrap.className = "settings-toggle-field";

    const input = document.createElement("input");
    input.id = inputId;
    input.type = "checkbox";

    const text = document.createElement("span");
    text.textContent = labelText;

    wrap.appendChild(input);
    wrap.appendChild(text);
    parent.appendChild(wrap);
    return input;
}

function setSettingsTab(tabName) {
    document.querySelectorAll(".settings-tab-btn").forEach((btn) => {
        const active = btn.dataset.tab === tabName;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll(".settings-tab-panel").forEach((panel) => {
        panel.classList.toggle("hidden", panel.dataset.tab !== tabName);
    });
}

function createNotesFolderPicker(parent) {
    const wrap = document.createElement("div");
    wrap.className = "settings-field settings-folder-field";

    const label = document.createElement("span");
    label.textContent = "Notes folder";

    const row = document.createElement("div");
    row.className = "settings-folder-row";

    const pathInput = document.createElement("input");
    pathInput.id = "settings-notes-folder-path";
    pathInput.type = "text";
    pathInput.readOnly = true;
    pathInput.placeholder = "No folder selected";
    pathInput.setAttribute("aria-readonly", "true");

    const browseBtn = document.createElement("button");
    browseBtn.id = "settings-notes-folder-browse";
    browseBtn.type = "button";
    browseBtn.className = "settings-btn";
    browseBtn.textContent = "Browse...";
    browseBtn.addEventListener("click", () => {
        browseNotesFolder().catch((err) => {
            showSettingsError(err.message || "Failed to pick folder");
        });
    });

    row.appendChild(pathInput);
    row.appendChild(browseBtn);
    wrap.appendChild(label);
    wrap.appendChild(row);
    parent.appendChild(wrap);
}

function updateNotesFolderControls() {
    const enabled = Boolean(document.getElementById("settings-notes-enabled")?.checked);
    const pathInput = document.getElementById("settings-notes-folder-path");
    if (pathInput) {
        pathInput.classList.toggle("settings-folder-empty", !pathInput.value.trim());
        pathInput.placeholder = enabled ? "No folder selected" : "Select a folder with Browse...";
    }
}

async function browseNotesFolder() {
    const browseBtn = document.getElementById("settings-notes-folder-browse");
    const current = document.getElementById("settings-notes-folder-path")?.value.trim() || "";
    if (browseBtn) browseBtn.disabled = true;
    try {
        const data = await pickNotesFolder(current, "Notes folder");
        if (data.cancelled) return;
        setSettingsFieldValue("settings-notes-folder-path", data.folderPath || "");
        showSettingsError("");
    } finally {
        updateNotesFolderControls();
    }
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

    const tabs = document.createElement("div");
    tabs.className = "settings-tabs";
    tabs.setAttribute("role", "tablist");

    const calendarTab = document.createElement("button");
    calendarTab.type = "button";
    calendarTab.className = "settings-tab-btn active";
    calendarTab.dataset.tab = "calendar";
    calendarTab.textContent = "Calendar";
    calendarTab.setAttribute("role", "tab");
    calendarTab.setAttribute("aria-selected", "true");
    calendarTab.addEventListener("click", () => setSettingsTab("calendar"));

    const notesTab = document.createElement("button");
    notesTab.type = "button";
    notesTab.className = "settings-tab-btn";
    notesTab.dataset.tab = "notes";
    notesTab.textContent = "Notes";
    notesTab.setAttribute("role", "tab");
    notesTab.setAttribute("aria-selected", "false");
    notesTab.addEventListener("click", () => setSettingsTab("notes"));

    tabs.appendChild(calendarTab);
    tabs.appendChild(notesTab);

    const body = document.createElement("div");
    body.className = "settings-form";

    const calendarPanel = document.createElement("div");
    calendarPanel.className = "settings-tab-panel";
    calendarPanel.dataset.tab = "calendar";

    const notesPanel = document.createElement("div");
    notesPanel.className = "settings-tab-panel hidden";
    notesPanel.dataset.tab = "notes";

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

    const filterSection = document.createElement("div");
    filterSection.className = "settings-section";
    const filterTitle = document.createElement("div");
    filterTitle.className = "settings-section-title";
    filterTitle.textContent = "Visible Calendars";
    filterSection.appendChild(filterTitle);

    const filterHint = document.createElement("p");
    filterHint.className = "settings-hint";
    filterHint.textContent = "Leave all unchecked to show every calendar.";
    filterSection.appendChild(filterHint);

    const filterList = document.createElement("div");
    filterList.id = "settings-calendar-filter";
    filterList.className = "settings-calendar-filter";
    filterSection.appendChild(filterList);
    syncSection.appendChild(filterSection);

    const hint = document.createElement("p");
    hint.id = "settings-password-hint";
    hint.className = "settings-hint";
    hint.textContent = "";
    syncSection.appendChild(hint);

    const error = document.createElement("p");
    error.id = "settings-error";
    error.className = "settings-error";
    calendarPanel.appendChild(bgActions);
    calendarPanel.appendChild(syncSection);

    const notesSection = document.createElement("div");
    notesSection.className = "settings-section";
    const notesTitle = document.createElement("div");
    notesTitle.className = "settings-section-title";
    notesTitle.textContent = "Notes Window";
    notesSection.appendChild(notesTitle);
    createSettingsToggle(notesSection, "Enable notes window", "settings-notes-enabled");
    createNotesFolderPicker(notesSection);
    document.getElementById("settings-notes-enabled")?.addEventListener("change", updateNotesFolderControls);

    const notesHint = document.createElement("p");
    notesHint.className = "settings-hint";
    notesHint.textContent = "Choose a folder with markdown files. Subfolders are included.";
    notesSection.appendChild(notesHint);
    notesPanel.appendChild(notesSection);

    body.appendChild(tabs);
    body.appendChild(calendarPanel);
    body.appendChild(notesPanel);
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

function setSettingsCheckboxValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(value);
}

async function loadSettingsIntoForm() {
    showSettingsError("");
    setSettingsFieldValue("settings-app-password", "");

    try {
        const settings = await fetchSyncSettings();
        setSettingsFieldValue("settings-apple-id", settings.appleId || "");
        setSettingsFieldValue("settings-sync-interval", String(settings.syncIntervalMinutes || 10));
        setSettingsCheckboxValue("settings-notes-enabled", settings.notesEnabled);
        setSettingsFieldValue("settings-notes-folder-path", settings.notesFolderPath || "");
        updateNotesFolderControls();
        const hint = document.getElementById("settings-password-hint");
        if (hint) {
            hint.textContent = settings.hasAppPassword
                ? "Password is saved locally. Leave blank to keep it."
                : "No app password saved yet.";
        }
    } catch {
        showSettingsError("Sync service unavailable. Start it to edit settings.");
    }
}

function readSettingsPayload() {
    const appleId = document.getElementById("settings-apple-id")?.value.trim() || "";
    const appPassword = document.getElementById("settings-app-password")?.value || "";
    const rawInterval = document.getElementById("settings-sync-interval")?.value.trim() || "";
    const syncIntervalMinutes = Number(rawInterval);
    const notesEnabled = Boolean(document.getElementById("settings-notes-enabled")?.checked);
    const notesFolderPath = document.getElementById("settings-notes-folder-path")?.value.trim() || "";

    if (!appleId) {
        throw new Error("APPLE_ID is required");
    }
    if (!Number.isInteger(syncIntervalMinutes) || syncIntervalMinutes <= 0) {
        throw new Error("SYNC_INTERVAL_MINUTES must be a positive integer");
    }
    if (notesEnabled && !notesFolderPath) {
        throw new Error("Select a notes folder before enabling notes");
    }

    return { appleId, appPassword, syncIntervalMinutes, notesEnabled, notesFolderPath };
}

function readCalendarFilterFromSettings() {
    const container = document.getElementById("settings-calendar-filter");
    if (!container) return [];
    const ids = [];
    container.querySelectorAll('input[type="checkbox"]:checked').forEach((input) => {
        if (input.value) ids.push(input.value);
    });
    return ids;
}

function saveCalendarFilterSelection(ids) {
    AppConfig.calendarFilter = ids;
    try {
        localStorage.setItem("calendarFilterIds", JSON.stringify(ids));
    } catch {
        /* ignore */
    }
    if (typeof filterEvents === "function" && typeof calendarData !== "undefined") {
        calendarData.events = filterEvents(calendarData.events || []);
    }
    if (typeof renderCurrentView === "function") renderCurrentView();
}

function populateCalendarFilterSettings() {
    const container = document.getElementById("settings-calendar-filter");
    if (!container) return;

    const calendars = typeof getCalendars === "function" ? getCalendars() : [];
    const selected = new Set(AppConfig.calendarFilter || []);

    if (!calendars.length) {
        container.innerHTML = '<p class="settings-hint">Sync first to load calendars.</p>';
        return;
    }

    container.innerHTML = "";
    for (const cal of calendars) {
        const label = document.createElement("label");
        label.className = "settings-calendar-filter-item";

        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = cal.id;
        input.checked = selected.size === 0 || selected.has(cal.id);

        const swatch = document.createElement("span");
        swatch.className = "calendar-swatch";
        swatch.style.background = cal.color || "#3a588e";

        const text = document.createElement("span");
        text.textContent = cal.name || cal.id;

        label.appendChild(input);
        label.appendChild(swatch);
        label.appendChild(text);
        container.appendChild(label);
    }
}

function loadCalendarFilterFromStorage() {
    try {
        const raw = localStorage.getItem("calendarFilterIds");
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) AppConfig.calendarFilter = parsed;
        }
    } catch {
        /* ignore */
    }
}

async function submitSettings() {
    const saveBtn = document.getElementById("settings-save-btn");
    if (saveBtn?.disabled) return;

    try {
        if (saveBtn) saveBtn.disabled = true;
        showSettingsError("");
        const payload = readSettingsPayload();
        await saveSyncSettings(payload);
        saveCalendarFilterSelection(readCalendarFilterFromSettings());
        AppConfig.pollIntervalMs = payload.syncIntervalMinutes * 60 * 1000;
        if (typeof restartPolling === "function") {
            restartPolling(AppConfig.pollIntervalMs);
        }
        setSettingsFieldValue("settings-app-password", "");
        updateSyncStatus("Settings saved");
        if (typeof refreshNotesSettings === "function") {
            refreshNotesSettings();
        }
        closeSettingsPanel();
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

function openSettingsPanel() {
    const host = document.getElementById("settings-panel-host");
    if (!host || !buildSettingsPanelDom()) return;
    host.classList.remove("hidden");
    populateCalendarFilterSettings();
    loadSettingsIntoForm();
}

function closeSettingsPanel() {
    document.getElementById("settings-panel-host")?.classList.add("hidden");
}

function initSettingsPanel() {
    loadCalendarFilterFromStorage();
    buildSettingsPanelDom();
    document.getElementById("settings-btn")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSettingsPanel();
    });
}

let notesState = {
    enabled: false,
    files: [],
    selectedPath: "",
    tasks: [],
    loading: false,
    error: "",
    collapsed: false,
    hideCompleted: false,
    pollTimer: null,
    dragging: false,
    resizing: false,
    dragStart: null,
    resizeStart: null
};

function readJsonStorage(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writeJsonStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* ignore */
    }
}

function loadNotesPrefs() {
    notesState.collapsed = localStorage.getItem(AppConfig.notesCollapsedKey) === "1";
    notesState.hideCompleted = localStorage.getItem(AppConfig.notesHideCompletedKey) === "1";
    notesState.selectedPath = localStorage.getItem(AppConfig.notesSelectedFileKey) || "";
}

function saveNotesSelectedPath(path) {
    notesState.selectedPath = path || "";
    try {
        localStorage.setItem(AppConfig.notesSelectedFileKey, notesState.selectedPath);
    } catch {
        /* ignore */
    }
}

function applyNotesVisibility() {
    const card = document.getElementById("notes-card");
    if (!card) return;
    card.classList.toggle("hidden", !notesState.enabled);
    card.classList.toggle("collapsed", notesState.collapsed);
}

function applyNotesPosition() {
    const card = document.getElementById("notes-card");
    if (!card) return;
    const pos = readJsonStorage(AppConfig.notesPositionKey) || { xPct: 78, yPct: 52 };
    card.style.setProperty("--notes-x", `${pos.xPct}%`);
    card.style.setProperty("--notes-y", `${pos.yPct}%`);
}

function applyNotesSize() {
    const card = document.getElementById("notes-card");
    if (!card) return;
    const size = clampNotesSize(readJsonStorage(AppConfig.notesSizeKey) || { width: 420, height: 560 });
    card.style.setProperty("--notes-width", `${size.width}px`);
    card.style.setProperty("--notes-height", `${size.height}px`);
}

function clampNotesSize(size) {
    const minWidth = 300;
    const minHeight = 220;
    const maxWidth = Math.max(minWidth, window.innerWidth * 0.92);
    const maxHeight = Math.max(minHeight, window.innerHeight * 0.88);
    return {
        width: Math.round(Math.min(maxWidth, Math.max(minWidth, size.width))),
        height: Math.round(Math.min(maxHeight, Math.max(minHeight, size.height)))
    };
}

function clampNotesPosition(x, y, width, height) {
    const margin = 8;
    const halfW = width / 2;
    const halfH = height / 2;
    const minX = Math.min(window.innerWidth / 2, halfW + margin);
    const maxX = Math.max(minX, window.innerWidth - halfW - margin);
    const minY = Math.min(window.innerHeight / 2, halfH + margin);
    const maxY = Math.max(minY, window.innerHeight - halfH - margin);
    return {
        x: Math.min(maxX, Math.max(minX, x)),
        y: Math.min(maxY, Math.max(minY, y))
    };
}

function setNotesCollapsed(collapsed, persist = true) {
    notesState.collapsed = collapsed;
    applyNotesVisibility();
    const btn = document.getElementById("notes-collapse-btn");
    if (btn) btn.textContent = collapsed ? "+" : "-";
    if (persist) {
        localStorage.setItem(AppConfig.notesCollapsedKey, collapsed ? "1" : "0");
    }
}

function setNotesHideCompleted(hideCompleted, persist = true) {
    notesState.hideCompleted = hideCompleted;
    const input = document.getElementById("notes-hide-completed");
    if (input) input.checked = hideCompleted;
    if (persist) {
        localStorage.setItem(AppConfig.notesHideCompletedKey, hideCompleted ? "1" : "0");
    }
    renderNotesTasks();
}

function setNotesError(message) {
    notesState.error = message || "";
    renderNotesTasks();
}

function setNotesLoading(loading) {
    notesState.loading = loading;
    renderNotesTasks();
}

function ensureSelectedNotesFile() {
    const exists = notesState.files.some((file) => file.path === notesState.selectedPath);
    if (!exists) {
        saveNotesSelectedPath(notesState.files[0]?.path || "");
    }
}

function renderNotesFileDropdown() {
    const wrap = document.getElementById("notes-file-dropdown");
    const trigger = document.getElementById("notes-file-trigger");
    const list = document.getElementById("notes-file-list");
    const hidden = document.getElementById("notes-file-path");
    if (!wrap || !trigger || !list || !hidden) return;

    hidden.value = notesState.selectedPath;
    list.innerHTML = "";
    wrap._customSelectOptions = notesState.files.map((file) => ({
        value: file.path,
        label: file.name || file.path
    }));

    if (!notesState.files.length) {
        trigger.textContent = "No markdown files";
        trigger.disabled = true;
        return;
    }

    trigger.disabled = false;
    const selected = notesState.files.find((file) => file.path === notesState.selectedPath);
    trigger.textContent = selected ? selected.name || selected.path : "Select note";

    for (const file of notesState.files) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "custom-select-option";
        btn.dataset.value = file.path;
        btn.textContent = file.name || file.path;
        btn.setAttribute("role", "option");
        const active = file.path === notesState.selectedPath;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            saveNotesSelectedPath(file.path);
            list.classList.add("hidden");
            wrap.classList.remove("open");
            trigger.setAttribute("aria-expanded", "false");
            renderNotesFileDropdown();
            loadSelectedNoteFile();
        });
        list.appendChild(btn);
    }
}

function renderNotesTasks() {
    const content = document.getElementById("notes-content");
    if (!content) return;

    if (!notesState.enabled) {
        content.innerHTML = '<p class="empty-state">Notes are disabled</p>';
        return;
    }
    if (notesState.error) {
        content.innerHTML = `<p class="notes-error">${escapeHtml(notesState.error)}</p>`;
        return;
    }
    if (notesState.loading && !notesState.tasks.length) {
        content.innerHTML = '<p class="empty-state">Loading notes...</p>';
        return;
    }
    if (!notesState.files.length) {
        content.innerHTML = '<p class="empty-state">No markdown files found</p>';
        return;
    }
    if (!notesState.selectedPath) {
        content.innerHTML = '<p class="empty-state">Select a note</p>';
        return;
    }

    const tasks = notesState.hideCompleted
        ? notesState.tasks.filter((task) => !task.checked)
        : notesState.tasks;

    if (!tasks.length) {
        content.innerHTML = '<p class="empty-state">No visible tasks</p>';
        return;
    }

    content.innerHTML = "";
    for (const task of tasks) {
        const row = document.createElement("label");
        row.className = "notes-task";
        row.classList.toggle("completed", task.checked);
        row.style.setProperty("--task-depth", String(Math.min(task.depth || 0, 8)));

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = task.checked;
        checkbox.addEventListener("change", () => {
            submitNoteTaskToggle(task.lineIndex, checkbox.checked, task.text || "");
        });

        const text = document.createElement("span");
        text.textContent = task.text || "";

        row.appendChild(checkbox);
        row.appendChild(text);
        content.appendChild(row);
    }
}

async function loadNotesFiles({ keepError = false } = {}) {
    if (!keepError) setNotesError("");
    const data = await fetchNotesFiles();
    notesState.enabled = Boolean(data.enabled);
    notesState.files = data.files || [];
    ensureSelectedNotesFile();
    applyNotesVisibility();
    renderNotesFileDropdown();
    return data;
}

async function loadSelectedNoteFile() {
    if (!notesState.enabled || !notesState.selectedPath) {
        notesState.tasks = [];
        renderNotesTasks();
        return;
    }
    setNotesLoading(true);
    try {
        const data = await fetchNoteFile(notesState.selectedPath);
        notesState.tasks = data.tasks || [];
        setNotesError("");
    } catch (err) {
        notesState.tasks = [];
        setNotesError(err.message || "Failed to load note");
    } finally {
        setNotesLoading(false);
    }
}

async function refreshNotesSettings() {
    try {
        await loadNotesFiles();
        await loadSelectedNoteFile();
    } catch (err) {
        notesState.enabled = false;
        notesState.files = [];
        notesState.tasks = [];
        applyNotesVisibility();
        setNotesError(err.message || "Failed to load notes");
    }
}

async function pollNotes() {
    if (!notesState.enabled) {
        try {
            await loadNotesFiles({ keepError: true });
        } catch {
            return;
        }
    } else {
        try {
            const before = notesState.selectedPath;
            await loadNotesFiles({ keepError: true });
            if (notesState.selectedPath !== before || notesState.selectedPath) {
                await loadSelectedNoteFile();
            }
        } catch (err) {
            setNotesError(err.message || "Failed to refresh notes");
        }
    }
}

async function submitNoteTaskToggle(lineIndex, checked, expectedText) {
    if (!notesState.selectedPath) return;
    try {
        const data = await toggleNoteTask(notesState.selectedPath, lineIndex, checked, expectedText);
        notesState.tasks = data.tasks || [];
        setNotesError("");
        renderNotesTasks();
    } catch (err) {
        setNotesError(err.message || "Failed to update task");
        await loadSelectedNoteFile();
    }
}

function initNotesDropdown() {
    const wrap = document.getElementById("notes-file-dropdown");
    const trigger = document.getElementById("notes-file-trigger");
    const list = document.getElementById("notes-file-list");
    if (!wrap || !trigger || !list) return;

    trigger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (trigger.disabled) return;
        const willOpen = list.classList.contains("hidden");
        if (typeof closeAllCustomSelects === "function") {
            closeAllCustomSelects(wrap);
        }
        list.classList.toggle("hidden", !willOpen);
        wrap.classList.toggle("open", willOpen);
        trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
}

function initNotesDrag() {
    const card = document.getElementById("notes-card");
    const header = document.getElementById("notes-header");
    if (!card || !header) return;

    function moveDrag(e) {
        if (!notesState.dragging || !notesState.dragStart) return;
        const nextX = notesState.dragStart.centerX + e.clientX - notesState.dragStart.pointerX;
        const nextY = notesState.dragStart.centerY + e.clientY - notesState.dragStart.pointerY;
        const clamped = clampNotesPosition(
            nextX,
            nextY,
            notesState.dragStart.width,
            notesState.dragStart.height
        );
        const xPct = (clamped.x / window.innerWidth) * 100;
        const yPct = (clamped.y / window.innerHeight) * 100;
        card.style.setProperty("--notes-x", `${xPct}%`);
        card.style.setProperty("--notes-y", `${yPct}%`);
        e.preventDefault();
    }

    function endDrag() {
        if (!notesState.dragging) return;
        notesState.dragging = false;
        notesState.dragStart = null;
        card.classList.remove("dragging");
        header.classList.remove("dragging");
        const xPct = parseFloat(card.style.getPropertyValue("--notes-x")) || 78;
        const yPct = parseFloat(card.style.getPropertyValue("--notes-y")) || 52;
        writeJsonStorage(AppConfig.notesPositionKey, { xPct, yPct });
        window.removeEventListener("pointermove", moveDrag);
        window.removeEventListener("pointerup", endDrag);
        window.removeEventListener("pointercancel", endDrag);
        window.removeEventListener("blur", endDrag);
    }

    header.addEventListener("pointerdown", (e) => {
        if (e.target.closest("button, input, label, .custom-select")) return;
        const rect = card.getBoundingClientRect();
        notesState.dragging = true;
        notesState.dragStart = {
            pointerX: e.clientX,
            pointerY: e.clientY,
            centerX: rect.left + rect.width / 2,
            centerY: rect.top + rect.height / 2,
            width: rect.width,
            height: rect.height
        };
        card.classList.add("dragging");
        header.classList.add("dragging");
        window.addEventListener("pointermove", moveDrag);
        window.addEventListener("pointerup", endDrag);
        window.addEventListener("pointercancel", endDrag);
        window.addEventListener("blur", endDrag);
        e.preventDefault();
    });
}

function initNotesResize() {
    const card = document.getElementById("notes-card");
    const handle = document.getElementById("notes-resize-handle");
    if (!card || !handle) return;

    function moveResize(e) {
        if (!notesState.resizing || !notesState.resizeStart) return;
        const size = clampNotesSize({
            width: notesState.resizeStart.width + e.clientX - notesState.resizeStart.x,
            height: notesState.resizeStart.height + e.clientY - notesState.resizeStart.y
        });
        card.style.setProperty("--notes-width", `${size.width}px`);
        card.style.setProperty("--notes-height", `${size.height}px`);
    }

    function endResize() {
        if (!notesState.resizing) return;
        notesState.resizing = false;
        notesState.resizeStart = null;
        card.classList.remove("resizing");
        writeJsonStorage(AppConfig.notesSizeKey, {
            width: card.getBoundingClientRect().width,
            height: card.getBoundingClientRect().height
        });
        window.removeEventListener("pointermove", moveResize);
        window.removeEventListener("pointerup", endResize);
        window.removeEventListener("pointercancel", endResize);
        window.removeEventListener("blur", endResize);
    }

    handle.addEventListener("pointerdown", (e) => {
        if (notesState.collapsed) return;
        const rect = card.getBoundingClientRect();
        notesState.resizing = true;
        notesState.resizeStart = {
            x: e.clientX,
            y: e.clientY,
            width: rect.width,
            height: rect.height
        };
        card.classList.add("resizing");
        window.addEventListener("pointermove", moveResize);
        window.addEventListener("pointerup", endResize);
        window.addEventListener("pointercancel", endResize);
        window.addEventListener("blur", endResize);
        e.preventDefault();
        e.stopPropagation();
    });

    window.addEventListener("resize", () => {
        applyNotesPosition();
        applyNotesSize();
    });
}

function initNotesWindow() {
    loadNotesPrefs();
    applyNotesPosition();
    applyNotesSize();
    setNotesCollapsed(notesState.collapsed, false);
    setNotesHideCompleted(notesState.hideCompleted, false);

    document.getElementById("notes-collapse-btn")?.addEventListener("click", () => {
        setNotesCollapsed(!notesState.collapsed);
    });
    document.getElementById("notes-hide-completed")?.addEventListener("change", (e) => {
        setNotesHideCompleted(e.target.checked);
    });

    initNotesDropdown();
    initNotesDrag();
    initNotesResize();

    refreshNotesSettings();
    if (notesState.pollTimer) window.clearInterval(notesState.pollTimer);
    notesState.pollTimer = window.setInterval(pollNotes, AppConfig.notesPollIntervalMs);
}

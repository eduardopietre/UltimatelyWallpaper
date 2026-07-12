let notesState = {
    enabled: false,
    visible: false,
    files: [],
    selectedPath: "",
    tasks: [],
    headings: [],
    selectedLineIndex: null,
    loading: false,
    error: "",
    collapsed: false,
    hideCompleted: false,
    positionLocked: false,
    pollTimer: null
};

let notesDraggable = null;

function readJsonStorage(key) {
    try {
        const raw = typeof readPersistentStorage === "function"
            ? readPersistentStorage(key)
            : localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function writeJsonStorage(key, value) {
    try {
        const serialized = JSON.stringify(value);
        if (typeof writePersistentStorage === "function") {
            writePersistentStorage(key, serialized);
        } else {
            localStorage.setItem(key, serialized);
        }
    } catch {
        /* ignore */
    }
}

function loadNotesPrefs() {
    notesState.collapsed = readPersistentStorage(AppConfig.notesCollapsedKey) === "1";
    notesState.hideCompleted = readPersistentStorage(AppConfig.notesHideCompletedKey) === "1";
    notesState.selectedPath = readPersistentStorage(AppConfig.notesSelectedFileKey) || "";
    notesState.positionLocked = readPersistentStorage(AppConfig.notesPositionLockKey) === "1";
}

function saveNotesPositionLocked(locked) {
    notesState.positionLocked = locked;
    try {
        writePersistentStorage(AppConfig.notesPositionLockKey, locked ? "1" : "0");
    } catch {
        /* ignore */
    }
}

function updateNotesPositionLockUi() {
    const card = document.getElementById("notes-card");
    const btn = document.getElementById("notes-position-lock-btn");
    if (card) {
        card.classList.toggle("position-locked", notesState.positionLocked);
    }
    if (btn) {
        btn.classList.toggle("locked", notesState.positionLocked);
        Icons.setLock(btn, notesState.positionLocked);
        const label = notesState.positionLocked ? "Unlock position" : "Lock position";
        btn.title = label;
        btn.setAttribute("aria-label", label);
    }
}

function saveNotesSelectedPath(path) {
    notesState.selectedPath = path || "";
    try {
        writePersistentStorage(AppConfig.notesSelectedFileKey, notesState.selectedPath);
    } catch {
        /* ignore */
    }
}

function applyNotesVisibility() {
    const card = document.getElementById("notes-card");
    if (!card) return;
    const shouldShow = notesState.enabled && notesState.visible;
    card.classList.toggle("hidden", !shouldShow);
    card.classList.toggle("collapsed", notesState.collapsed);
}

function setNotesVisible(visible) {
    notesState.visible = !!visible;
    applyNotesVisibility();
    if (visible) scheduleEnsureNotesOnScreen();
}

function loadNotesPosition() {
    const pos = readJsonStorage(AppConfig.notesPositionKey);
    if (!pos || typeof pos.xPct !== "number" || typeof pos.yPct !== "number") {
        return null;
    }
    if (pos.anchor !== "topleft") {
        pos.legacyCenter = true;
    }
    return pos;
}

function saveNotesPosition(xPct, yPct) {
    writeJsonStorage(AppConfig.notesPositionKey, { xPct, yPct, anchor: "topleft" });
}

function notesPxToPct(x, y) {
    return {
        xPct: (x / window.innerWidth) * 100,
        yPct: (y / window.innerHeight) * 100
    };
}

function clampNotesTopLeft(x, y, width, height) {
    const margin = 8;
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    let clampedX = x;
    let clampedY = y;

    if (width + margin * 2 <= viewW) {
        clampedX = Math.min(viewW - width - margin, Math.max(margin, x));
    } else {
        clampedX = Math.max(margin, (viewW - width) / 2);
    }

    if (height + margin * 2 <= viewH) {
        clampedY = Math.min(viewH - height - margin, Math.max(margin, y));
    } else {
        clampedY = Math.max(margin, (viewH - height) / 2);
    }

    return { x: clampedX, y: clampedY };
}

function migrateLegacyNotesPosition(card) {
    const pos = loadNotesPosition();
    if (!pos?.legacyCenter) return;

    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const centerX = (pos.xPct / 100) * window.innerWidth;
    const centerY = (pos.yPct / 100) * window.innerHeight;
    const migrated = notesPxToPct(centerX - rect.width / 2, centerY - rect.height / 2);
    saveNotesPosition(migrated.xPct, migrated.yPct);
}

function scheduleEnsureNotesOnScreen() {
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
            ensureNotesOnScreen();
        });
    });
}

function ensureNotesOnScreen() {
    const card = document.getElementById("notes-card");
    if (!card || card.classList.contains("hidden")) return;

    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const saved = loadNotesPosition();
    if (!saved) {
        const centered = clampNotesTopLeft(
            (window.innerWidth - rect.width) / 2,
            Math.max(8, window.innerHeight * 0.08),
            rect.width,
            rect.height
        );
        const pct = notesPxToPct(centered.x, centered.y);
        card.classList.add("position-snap");
        card.style.setProperty("--notes-x", `${pct.xPct}%`);
        card.style.setProperty("--notes-y", `${pct.yPct}%`);
        saveNotesPosition(pct.xPct, pct.yPct);
        window.requestAnimationFrame(() => card.classList.remove("position-snap"));
        return;
    }

    migrateLegacyNotesPosition(card);

    const clamped = clampNotesTopLeft(rect.left, rect.top, rect.width, rect.height);
    const pct = notesPxToPct(clamped.x, clamped.y);
    const currentX = parseFloat(card.style.getPropertyValue("--notes-x")) || saved.xPct;
    const currentY = parseFloat(card.style.getPropertyValue("--notes-y")) || saved.yPct;

    if (Math.abs(currentX - pct.xPct) < 0.05 && Math.abs(currentY - pct.yPct) < 0.05) {
        return;
    }

    const snap = !card.classList.contains("dragging") && !card.classList.contains("resizing");
    if (snap) {
        card.classList.add("position-snap");
    }
    card.style.setProperty("--notes-x", `${pct.xPct}%`);
    card.style.setProperty("--notes-y", `${pct.yPct}%`);
    saveNotesPosition(pct.xPct, pct.yPct);
    if (snap) {
        window.requestAnimationFrame(() => card.classList.remove("position-snap"));
    }
}

function applyNotesPosition() {
    const card = document.getElementById("notes-card");
    if (!card) return;
    const pos = loadNotesPosition();
    if (pos) {
        card.style.setProperty("--notes-x", `${pos.xPct}%`);
        card.style.setProperty("--notes-y", `${pos.yPct}%`);
    } else {
        card.style.removeProperty("--notes-x");
        card.style.removeProperty("--notes-y");
    }
    scheduleEnsureNotesOnScreen();
}

function applyNotesSizeForState() {
    const card = document.getElementById("notes-card");
    if (!card) return;

    if (notesState.collapsed) {
        card.style.removeProperty("--notes-height");
        return;
    }

    const size = clampNotesSize(readJsonStorage(AppConfig.notesSizeKey) || { width: 420, height: 560 });
    card.style.setProperty("--notes-width", `${size.width}px`);
    card.style.setProperty("--notes-height", `${size.height}px`);
}

function applyNotesSize() {
    applyNotesSizeForState();
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

function setNotesCollapsed(collapsed, persist = true) {
    notesState.collapsed = collapsed;
    applyNotesVisibility();
    applyNotesSizeForState();
    scheduleEnsureNotesOnScreen();
    const btn = document.getElementById("notes-collapse-btn");
    if (btn) Icons.setCollapse(btn, collapsed);
    if (persist) {
        writePersistentStorage(AppConfig.notesCollapsedKey, collapsed ? "1" : "0");
    }
}

function setNotesHideCompleted(hideCompleted, persist = true) {
    notesState.hideCompleted = hideCompleted;
    const input = document.getElementById("notes-hide-completed");
    if (input) input.checked = hideCompleted;
    if (persist) {
        writePersistentStorage(AppConfig.notesHideCompletedKey, hideCompleted ? "1" : "0");
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
            clearNotesTaskSelection();
            list.classList.add("hidden");
            wrap.classList.remove("open");
            trigger.setAttribute("aria-expanded", "false");
            renderNotesFileDropdown();
            loadSelectedNoteFile();
        });
        list.appendChild(btn);
    }
}

function getVisibleNotesTasks() {
    if (notesState.hideCompleted) {
        return notesState.tasks.filter((task) => !task.checked);
    }
    return notesState.tasks;
}

function getSelectedNotesTask() {
    if (notesState.selectedLineIndex === null) return null;
    return notesState.tasks.find((task) => task.lineIndex === notesState.selectedLineIndex) || null;
}

function selectNotesTask(lineIndex) {
    notesState.selectedLineIndex = lineIndex;
    updateNotesToolbar();
    renderNotesTasks();
}

function clearNotesTaskSelection() {
    notesState.selectedLineIndex = null;
    updateNotesToolbar();
}

function updateNotesToolbar() {
    const label = document.getElementById("notes-selection-label");
    const task = getSelectedNotesTask();
    const actionState = task ? getTaskActionState(task) : null;
    const hasFile = Boolean(notesState.selectedPath);

    if (label) {
        if (!hasFile) {
            label.textContent = "Select a note file";
        } else if (!task) {
            label.textContent = "Select a task below";
        } else {
            const preview = task.text || "(empty task)";
            label.textContent = preview.length > 42 ? `${preview.slice(0, 42)}…` : preview;
        }
    }

    const setDisabled = (id, disabled) => {
        const el = document.getElementById(id);
        if (el) el.disabled = disabled;
    };

    setDisabled("notes-tool-add", !hasFile);
    setDisabled("notes-tool-open", !hasFile);
    setDisabled("notes-tool-up", !task || !actionState?.canMoveUp);
    setDisabled("notes-tool-down", !task || !actionState?.canMoveDown);
    setDisabled("notes-tool-outdent", !task || !actionState?.canOutdent);
    setDisabled("notes-tool-indent", !task || !actionState?.canIndent);
    setDisabled("notes-tool-edit", !task);
    setDisabled("notes-tool-subtask", !task);
    setDisabled("notes-tool-delete", !task);
}

function getTaskActionState(task) {
    const tasks = notesState.tasks;
    const index = tasks.findIndex((item) => item.lineIndex === task.lineIndex);
    if (index < 0) {
        return { canMoveUp: false, canMoveDown: false, canIndent: false, canOutdent: false };
    }

    let canMoveUp = false;
    for (let i = index - 1; i >= 0; i -= 1) {
        if (tasks[i].depth === task.depth) {
            canMoveUp = true;
            break;
        }
        if (tasks[i].depth < task.depth) break;
    }

    let canMoveDown = false;
    for (let i = index + 1; i < tasks.length; i += 1) {
        if (tasks[i].depth === task.depth) {
            canMoveDown = true;
            break;
        }
        if (tasks[i].depth < task.depth) break;
    }

    return {
        canMoveUp,
        canMoveDown,
        canIndent: index > 0,
        canOutdent: (task.depth || 0) > 0
    };
}

function renderNotesTasks() {
    const content = document.getElementById("notes-content");
    if (!content) return;

    updateNotesToolbar();

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

    const tasks = getVisibleNotesTasks();
    if (!tasks.length) {
        const fileName = notesState.selectedPath.split("/").pop() || notesState.selectedPath;
        let html = `<p class="notes-file-label">${escapeHtml(fileName)}</p>`;
        html += '<p class="empty-state">No tasks in this file.</p>';
        if (notesState.headings.length) {
            html += '<div class="notes-headings"><p class="notes-headings-title">Sections</p>';
            for (const heading of notesState.headings) {
                html += `<button type="button" class="notes-heading-btn" data-line-index="${heading.lineIndex}">${escapeHtml(heading.text)}</button>`;
            }
            html += "</div>";
        }
        content.innerHTML = html;
        content.querySelectorAll(".notes-heading-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                const lineIndex = parseInt(btn.dataset.lineIndex, 10);
                addNoteTaskAfterHeading(lineIndex);
            });
        });
        return;
    }

    if (
        notesState.selectedLineIndex !== null
        && !tasks.some((task) => task.lineIndex === notesState.selectedLineIndex)
    ) {
        clearNotesTaskSelection();
    }

    content.innerHTML = "";
    for (const task of tasks) {
        const row = document.createElement("div");
        row.className = "notes-task";
        row.classList.toggle("completed", task.checked);
        row.classList.toggle("selected", task.lineIndex === notesState.selectedLineIndex);
        row.style.setProperty("--task-depth", String(Math.min(task.depth || 0, 8)));

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = task.checked;
        checkbox.addEventListener("click", (e) => e.stopPropagation());
        checkbox.addEventListener("change", () => {
            submitNoteTaskToggle(task.lineIndex, checkbox.checked, task.text || "");
        });

        const text = document.createElement("span");
        text.className = "notes-task-text";
        text.textContent = task.text || "(empty task)";

        row.appendChild(checkbox);
        row.appendChild(text);
        row.addEventListener("click", () => {
            selectNotesTask(task.lineIndex);
        });
        content.appendChild(row);
    }
}

async function promptForTaskText(title, prompt, initialValue = "") {
    if (typeof showTextPrompt === "function") {
        return showTextPrompt({ title, prompt, initialValue });
    }
    const data = await promptNoteText(title, prompt, initialValue);
    if (data.cancelled) return null;
    const value = (data.value || "").trim();
    return value || null;
}

function countSubtasksForTask(task) {
    const tasks = notesState.tasks;
    const idx = tasks.findIndex((t) => t.lineIndex === task.lineIndex);
    if (idx < 0) return 0;
    let count = 0;
    for (let i = idx + 1; i < tasks.length; i++) {
        if (tasks[i].depth <= task.depth) break;
        count++;
    }
    return count;
}

async function addNoteTaskAfterHeading(lineIndex) {
    if (!notesState.selectedPath) return;
    const heading = notesState.headings.find((h) => h.lineIndex === lineIndex);
    const label = heading?.text || "section";
    try {
        const text = await promptForTaskText("New task", `Add a task under "${label}":`);
        if (!text) return;
        const data = await addNoteTask(notesState.selectedPath, text, lineIndex);
        notesState.tasks = data.tasks || [];
        notesState.headings = data.headings || notesState.headings;
        const created = notesState.tasks.find((task) => task.text === text);
        if (created) notesState.selectedLineIndex = created.lineIndex;
        setNotesError("");
        renderNotesTasks();
    } catch (err) {
        setNotesError(err.message || "Failed to add task");
    }
}

async function addNoteTaskPrompt() {
    if (!notesState.selectedPath) {
        setNotesError("Select a note file first");
        return;
    }
    const fileLabel = notesState.selectedPath.split("/").pop() || "note";
    try {
        const text = await promptForTaskText(
            "New task",
            `Add a task to ${fileLabel}:`,
        );
        if (!text) return;
        const afterLineIndex = notesState.selectedLineIndex;
        const data = await addNoteTask(
            notesState.selectedPath,
            text,
            afterLineIndex !== null ? afterLineIndex : null
        );
        notesState.tasks = data.tasks || [];
        notesState.headings = data.headings || notesState.headings;
        const created = notesState.tasks.find((task) => task.text === text);
        if (created) notesState.selectedLineIndex = created.lineIndex;
        setNotesError("");
        renderNotesTasks();
    } catch (err) {
        setNotesError(err.message || "Failed to add task");
    }
}

async function editSelectedNoteTaskPrompt() {
    const task = getSelectedNotesTask();
    if (!task || !notesState.selectedPath) return;
    const fileLabel = notesState.selectedPath.split("/").pop() || "note";
    try {
        const text = await promptForTaskText(
            "Edit task",
            `Update this task in ${fileLabel}:`,
            task.text || "",
        );
        if (!text || text === task.text) return;
        const data = await editNoteTask(
            notesState.selectedPath,
            task.lineIndex,
            text,
            task.text || "",
        );
        notesState.tasks = data.tasks || [];
        notesState.selectedLineIndex = task.lineIndex;
        setNotesError("");
        renderNotesTasks();
    } catch (err) {
        setNotesError(err.message || "Failed to edit task");
        await loadSelectedNoteFile();
    }
}

async function editNoteTaskPrompt(lineIndex, currentText) {
    selectNotesTask(lineIndex);
    await editSelectedNoteTaskPrompt();
}

async function addSubtaskPrompt(parentLineIndex, parentText) {
    if (!notesState.selectedPath) return;
    const parentLabel = parentText || "selected task";
    try {
        const text = await promptForTaskText(
            "New subtask",
            `Add a subtask under "${parentLabel}":`,
        );
        if (!text) return;
        const data = await addNoteSubtask(
            notesState.selectedPath,
            parentLineIndex,
            text,
            parentText,
        );
        notesState.tasks = data.tasks || [];
        const created = data.tasks.find(
            (task, index, list) =>
                index > 0
                && list[index - 1].lineIndex === parentLineIndex
                && task.text === text,
        );
        if (created) notesState.selectedLineIndex = created.lineIndex;
        setNotesError("");
        renderNotesTasks();
    } catch (err) {
        setNotesError(err.message || "Failed to add subtask");
        await loadSelectedNoteFile();
    }
}

async function addSelectedSubtaskPrompt() {
    const task = getSelectedNotesTask();
    if (!task) return;
    await addSubtaskPrompt(task.lineIndex, task.text || "");
}

async function confirmDeleteSelectedNoteTask() {
    const task = getSelectedNotesTask();
    if (!task) return;

    const subtasks = countSubtasksForTask(task);
    let message = `Delete "${task.text || "(empty task)"}"?`;
    if (subtasks > 0) {
        message += `\n\nThis will also remove ${subtasks} subtask${subtasks === 1 ? "" : "s"}.`;
    }
    const confirmed = typeof showConfirm === "function"
        ? await showConfirm({
            title: "Delete task",
            message,
            confirmLabel: "Delete",
            cancelLabel: "Cancel",
            danger: true
        })
        : window.confirm(message);
    if (!confirmed) return;

    clearNotesTaskSelection();
    await applyNoteTaskAction(task.lineIndex, "delete", task.text || "");
}

async function applySelectedNoteTaskAction(action) {
    const task = getSelectedNotesTask();
    if (!task) return;
    if (action === "delete") {
        await confirmDeleteSelectedNoteTask();
        return;
    }
    await applyNoteTaskAction(task.lineIndex, action, task.text || "");
}

async function applyNoteTaskAction(lineIndex, action, expectedText) {
    if (!notesState.selectedPath) return;
    try {
        const data = await noteTaskAction(
            notesState.selectedPath,
            lineIndex,
            action,
            expectedText
        );
        notesState.tasks = data.tasks || [];
        if (action !== "delete" && expectedText) {
            const matches = notesState.tasks.filter((task) => task.text === expectedText);
            if (matches.length === 1) {
                notesState.selectedLineIndex = matches[0].lineIndex;
            } else if (matches.length > 1) {
                const closest = matches.reduce((best, task) =>
                    Math.abs(task.lineIndex - lineIndex) < Math.abs(best.lineIndex - lineIndex)
                        ? task
                        : best
                );
                notesState.selectedLineIndex = closest.lineIndex;
            }
        } else if (
            notesState.selectedLineIndex !== null
            && !notesState.tasks.some((task) => task.lineIndex === notesState.selectedLineIndex)
        ) {
            clearNotesTaskSelection();
        }
        setNotesError("");
        renderNotesTasks();
    } catch (err) {
        setNotesError(err.message || "Failed to update task");
        await loadSelectedNoteFile();
    }
}

async function openSelectedNoteFile() {
    if (!notesState.selectedPath) {
        setNotesError("Select a note file first");
        return;
    }
    try {
        await openNoteFile(notesState.selectedPath);
        setNotesError("");
    } catch (err) {
        setNotesError(err.message || "Failed to open note file");
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
        clearNotesTaskSelection();
        renderNotesTasks();
        return;
    }
    setNotesLoading(true);
    try {
        const data = await fetchNoteFile(notesState.selectedPath);
        notesState.tasks = data.tasks || [];
        notesState.headings = data.headings || [];
        if (
            notesState.selectedLineIndex !== null
            && !notesState.tasks.some((task) => task.lineIndex === notesState.selectedLineIndex)
        ) {
            clearNotesTaskSelection();
        }
        setNotesError("");
    } catch (err) {
        notesState.tasks = [];
        clearNotesTaskSelection();
        setNotesError(err.message || "Failed to load note");
    } finally {
        setNotesLoading(false);
        renderNotesTasks();
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

    notesDraggable = makeDraggable({
        el: card,
        handle: header,
        xVar: "--notes-x",
        yVar: "--notes-y",
        save: saveNotesPosition,
        isLocked: () => notesState.positionLocked,
        skipSelector: "button, input, label, .custom-select, .notes-toolbar, .notes-task",
        defaultXPct: 72,
        defaultYPct: 8
    });
}

function initNotesResize() {
    const card = document.getElementById("notes-card");
    const handle = document.getElementById("notes-resize-handle");
    if (!card || !handle) return;

    makeResizable({
        el: card,
        handle,
        wVar: "--notes-width",
        hVar: "--notes-height",
        clamp: (width, height) => clampNotesSize({ width, height }),
        save: (size) => writeJsonStorage(AppConfig.notesSizeKey, size),
        disabled: () => notesState.collapsed,
        onResize: () => {
            if (!notesState.collapsed) ensureNotesOnScreen();
        }
    });

    window.addEventListener("resize", () => {
        applyNotesSizeForState();
        scheduleEnsureNotesOnScreen();
    });
}

function initNotesPositionLock() {
    const btn = document.getElementById("notes-position-lock-btn");
    if (!btn) return;

    makePositionLock({
        el: document.getElementById("notes-card"),
        btn,
        get: () => notesState.positionLocked,
        set: saveNotesPositionLocked,
        onToggle: () => notesDraggable?.cancel()
    });
}

function initNotesScroll() {
    const body = document.getElementById("notes-body");
    const content = document.getElementById("notes-content");
    if (!body || !content) return;

    function handleWheel(e) {
        if (notesState.collapsed || !notesState.enabled) return;

        const maxScroll = content.scrollHeight - content.clientHeight;
        if (maxScroll <= 0) return;

        e.preventDefault();
        e.stopPropagation();
        content.scrollTop = Math.max(0, Math.min(maxScroll, content.scrollTop + e.deltaY));
    }

    body.addEventListener("wheel", handleWheel, { passive: false });
    content.addEventListener("wheel", handleWheel, { passive: false });
}

function initNotesIcons() {
    Icons.set(document.getElementById("notes-tool-add"), "plus");
    Icons.set(document.getElementById("notes-tool-open"), "external-link");
    Icons.set(document.getElementById("notes-tool-up"), "arrow-up");
    Icons.set(document.getElementById("notes-tool-down"), "arrow-down");
    Icons.set(document.getElementById("notes-tool-outdent"), "list-indented-reversed");
    Icons.set(document.getElementById("notes-tool-indent"), "list-indented");
    Icons.set(document.getElementById("notes-tool-edit"), "pencil");
    Icons.set(document.getElementById("notes-tool-subtask"), "close-small");
    Icons.set(document.getElementById("notes-tool-delete"), "trash");
}

function initNotesToolbar() {
    const bind = (id, handler) => {
        document.getElementById(id)?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            handler();
        });
    };

    bind("notes-tool-add", addNoteTaskPrompt);
    bind("notes-tool-open", openSelectedNoteFile);
    bind("notes-tool-up", () => applySelectedNoteTaskAction("move_up"));
    bind("notes-tool-down", () => applySelectedNoteTaskAction("move_down"));
    bind("notes-tool-outdent", () => applySelectedNoteTaskAction("outdent"));
    bind("notes-tool-indent", () => applySelectedNoteTaskAction("indent"));
    bind("notes-tool-edit", editSelectedNoteTaskPrompt);
    bind("notes-tool-subtask", addSelectedSubtaskPrompt);
    bind("notes-tool-delete", confirmDeleteSelectedNoteTask);
    updateNotesToolbar();
}

function reloadNotesLayout() {
    loadNotesPrefs();
    setNotesCollapsed(notesState.collapsed, false);
    applyNotesPosition();
    applyNotesSize();
    updateNotesPositionLockUi();
    applyNotesVisibility();
}

function initNotesWindow() {
    loadNotesPrefs();
    setNotesCollapsed(notesState.collapsed, false);
    applyNotesPosition();
    setNotesHideCompleted(notesState.hideCompleted, false);

    document.getElementById("notes-collapse-btn")?.addEventListener("click", () => {
        setNotesCollapsed(!notesState.collapsed);
    });
    document.getElementById("notes-hide-completed")?.addEventListener("change", (e) => {
        setNotesHideCompleted(e.target.checked);
    });

    initNotesIcons();
    initNotesToolbar();
    initNotesPositionLock();
    initNotesScroll();
    initNotesDropdown();
    initNotesDrag();
    initNotesResize();

    if (typeof Gadgets !== "undefined") {
        Gadgets.register({
            id: "notes",
            defaultVisible: false,
            apply: (visible) => setNotesVisible(visible),
            isVisible: () => notesState.visible
        });
    }

    refreshNotesSettings();
    if (notesState.pollTimer) window.clearInterval(notesState.pollTimer);
    notesState.pollTimer = window.setInterval(pollNotes, AppConfig.notesPollIntervalMs);
}

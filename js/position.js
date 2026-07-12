let savedPosition = null;
let positionLocked = false;
let calendarDraggable = null;

function savePosition(xPct, yPct) {
    savedPosition = { xPct, yPct, anchor: "topleft" };
    writePersistentStorage(AppConfig.positionKey, JSON.stringify(savedPosition));
}

function loadSavedPosition() {
    try {
        const raw = readPersistentStorage(AppConfig.positionKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed.xPct === "number" && typeof parsed.yPct === "number") {
            if (parsed.anchor !== "topleft") {
                parsed.legacyCenter = true;
            }
            return parsed;
        }
    } catch {
        /* ignore */
    }
    return null;
}

function migrateLegacyCenterPosition(card) {
    if (!savedPosition?.legacyCenter) return;

    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const centerX = (savedPosition.xPct / 100) * window.innerWidth;
    const centerY = (savedPosition.yPct / 100) * window.innerHeight;
    const pct = pxToPct(centerX - rect.width / 2, centerY - rect.height / 2);
    savePosition(pct.xPct, pct.yPct);
}

function loadPositionLocked() {
    try {
        return readPersistentStorage(AppConfig.positionLockKey) === "1";
    } catch {
        return false;
    }
}

function savePositionLocked(locked) {
    positionLocked = locked;
    try {
        writePersistentStorage(AppConfig.positionLockKey, locked ? "1" : "0");
    } catch {
        /* ignore */
    }
}

function scheduleEnsureCardOnScreen() {
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
            ensureCardOnScreen();
        });
    });
}

function ensureCardOnScreen() {
    const card = document.getElementById("calendar-card");
    if (!card) return;

    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    if (!savedPosition) {
        const centered = clampTopLeftPx(
            (window.innerWidth - rect.width) / 2,
            Math.max(8, window.innerHeight * 0.08),
            rect.width,
            rect.height
        );
        const centeredPct = pxToPct(centered.x, centered.y);
        card.classList.add("position-snap");
        card.style.setProperty("--card-x", `${centeredPct.xPct}%`);
        card.style.setProperty("--card-y", `${centeredPct.yPct}%`);
        savePosition(centeredPct.xPct, centeredPct.yPct);
        window.requestAnimationFrame(() => {
            card.classList.remove("position-snap");
        });
        return;
    }

    migrateLegacyCenterPosition(card);

    const clamped = clampTopLeftPx(rect.left, rect.top, rect.width, rect.height);
    const pct = pxToPct(clamped.x, clamped.y);
    const currentX = parseFloat(card.style.getPropertyValue("--card-x")) || 50;
    const currentY = parseFloat(card.style.getPropertyValue("--card-y")) || 50;

    if (Math.abs(currentX - pct.xPct) < 0.05 && Math.abs(currentY - pct.yPct) < 0.05) {
        return;
    }

    const snap = !card.classList.contains("resizing") && !card.classList.contains("dragging");
    if (snap) {
        card.classList.add("position-snap");
    }
    card.style.setProperty("--card-x", `${pct.xPct}%`);
    card.style.setProperty("--card-y", `${pct.yPct}%`);
    savePosition(pct.xPct, pct.yPct);
    if (snap) {
        window.requestAnimationFrame(() => {
            card.classList.remove("position-snap");
        });
    }
}

function updatePositionLockUi() {
    const card = document.getElementById("calendar-card");
    if (card) {
        card.classList.toggle("position-locked", positionLocked);
    }
    const btn = document.getElementById("position-lock-btn");
    if (btn) {
        btn.classList.toggle("locked", positionLocked);
        Icons.setLock(btn, positionLocked);
        const label = positionLocked ? "Unlock position" : "Lock position";
        btn.title = label;
        btn.setAttribute("aria-label", label);
    }
}

function applyCardPosition() {
    const card = document.getElementById("calendar-card");
    if (!card) return;

    card.classList.remove("centered");
    if (savedPosition) {
        card.style.setProperty("--card-x", `${savedPosition.xPct}%`);
        card.style.setProperty("--card-y", `${savedPosition.yPct}%`);
    } else {
        card.style.removeProperty("--card-x");
        card.style.removeProperty("--card-y");
    }
    scheduleEnsureCardOnScreen();
}

function reloadSavedPosition() {
    savedPosition = loadSavedPosition();
    positionLocked = loadPositionLocked();
    applyCardPosition();
    updatePositionLockUi();
}

function initPosition() {
    savedPosition = loadSavedPosition();
    positionLocked = loadPositionLocked();
    const card = document.getElementById("calendar-card");
    const header = card?.querySelector(".calendar-header");
    const lockBtn = document.getElementById("position-lock-btn");
    if (!card || !header) return;

    applyCardPosition();

    calendarDraggable = makeDraggable({
        el: card,
        handle: header,
        xVar: "--card-x",
        yVar: "--card-y",
        save: savePosition,
        isLocked: () => positionLocked
    });

    makePositionLock({
        el: card,
        btn: lockBtn,
        get: () => positionLocked,
        set: savePositionLocked,
        onToggle: () => calendarDraggable?.cancel()
    });

    window.addEventListener("resize", scheduleEnsureCardOnScreen);
}

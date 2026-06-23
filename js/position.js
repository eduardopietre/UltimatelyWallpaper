let savedPosition = null;
let isDragging = false;
let positionLocked = false;
let activePointerId = null;
let dragStart = null;
let pendingDragFrame = null;
let pendingDragPoint = null;

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

function clampTopLeftPx(x, y, width, height) {
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

function migrateLegacyCenterPosition(card) {
    if (!savedPosition?.legacyCenter) return;

    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const centerX = (savedPosition.xPct / 100) * window.innerWidth;
    const centerY = (savedPosition.yPct / 100) * window.innerHeight;
    const pct = positionPxToPct(centerX - rect.width / 2, centerY - rect.height / 2);
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

function clampPositionPx(x, y, width, height) {
    return clampTopLeftPx(x - width / 2, y - height / 2, width, height);
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
        const centeredPct = positionPxToPct(centered.x, centered.y);
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

    const anchorX = rect.left;
    const anchorY = rect.top;
    const clamped = clampTopLeftPx(anchorX, anchorY, rect.width, rect.height);
    const pct = positionPxToPct(clamped.x, clamped.y);
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

function positionPxToPct(x, y) {
    return {
        xPct: (x / window.innerWidth) * 100,
        yPct: (y / window.innerHeight) * 100
    };
}

function updatePositionLockUi() {
    const card = document.getElementById("calendar-card");
    const btn = document.getElementById("position-lock-btn");
    if (card) {
        card.classList.toggle("position-locked", positionLocked);
    }
    if (btn) {
        btn.classList.toggle("locked", positionLocked);
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
    updatePositionLockUi();

    lockBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isDragging) endDrag();
        savePositionLocked(!positionLocked);
        updatePositionLockUi();
    });

    function applyDragPoint(point) {
        if (!dragStart) return;
        const nextX = dragStart.anchorX + point.x - dragStart.pointerX;
        const nextY = dragStart.anchorY + point.y - dragStart.pointerY;
        const clamped = clampTopLeftPx(nextX, nextY, dragStart.width, dragStart.height);
        const pct = positionPxToPct(clamped.x, clamped.y);

        card.style.setProperty("--card-x", `${pct.xPct}%`);
        card.style.setProperty("--card-y", `${pct.yPct}%`);
    }

    function scheduleDragMove(point) {
        pendingDragPoint = point;
        if (pendingDragFrame) return;
        pendingDragFrame = window.requestAnimationFrame(() => {
            pendingDragFrame = null;
            if (!pendingDragPoint) return;
            applyDragPoint(pendingDragPoint);
        });
    }

    function moveDrag(e) {
        if (!isDragging || e.pointerId !== activePointerId) return;
        scheduleDragMove({ x: e.clientX, y: e.clientY });
        e.preventDefault();
    }

    function endDrag(e) {
        if (!isDragging) return;
        if (e && activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) {
            return;
        }

        if (pendingDragFrame) {
            window.cancelAnimationFrame(pendingDragFrame);
            pendingDragFrame = null;
        }
        if (pendingDragPoint) {
            applyDragPoint(pendingDragPoint);
            pendingDragPoint = null;
        }

        const pointerId = activePointerId;
        isDragging = false;
        activePointerId = null;
        dragStart = null;
        header.classList.remove("dragging");
        card.classList.remove("dragging");

        const xPct = parseFloat(card.style.getPropertyValue("--card-x")) || 50;
        const yPct = parseFloat(card.style.getPropertyValue("--card-y")) || 50;
        savePosition(xPct, yPct);

        window.removeEventListener("pointermove", moveDrag);
        window.removeEventListener("pointerup", endDrag);
        window.removeEventListener("pointercancel", endDrag);
        window.removeEventListener("blur", endDrag);

        try {
            if (pointerId !== null && header.hasPointerCapture(pointerId)) {
                header.releasePointerCapture(pointerId);
            }
        } catch {
            /* Embedded webview may drop capture before pointerup */
        }
    }

    header.addEventListener("pointerdown", (e) => {
        if (positionLocked) return;
        if (e.target.closest("button, a, input, select, textarea, .custom-select")) return;

        const rect = card.getBoundingClientRect();
        isDragging = true;
        activePointerId = e.pointerId;
        dragStart = {
            pointerX: e.clientX,
            pointerY: e.clientY,
            anchorX: rect.left,
            anchorY: rect.top,
            width: rect.width,
            height: rect.height
        };

        try {
            header.setPointerCapture(e.pointerId);
        } catch {
            /* Pointer capture is best-effort in the Lively webview */
        }
        header.classList.add("dragging");
        card.classList.add("dragging");
        window.addEventListener("pointermove", moveDrag);
        window.addEventListener("pointerup", endDrag);
        window.addEventListener("pointercancel", endDrag);
        window.addEventListener("blur", endDrag);
        e.preventDefault();
    });

    window.addEventListener("resize", scheduleEnsureCardOnScreen);
}

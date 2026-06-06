let savedPosition = null;
let isDragging = false;
let positionLocked = false;
let activePointerId = null;
let dragStart = null;
let pendingDragFrame = null;
let pendingDragPoint = null;

function loadSavedPosition() {
    try {
        const raw = localStorage.getItem(AppConfig.positionKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed.xPct === "number" && typeof parsed.yPct === "number") {
            return parsed;
        }
    } catch {
        /* ignore */
    }
    return null;
}

function savePosition(xPct, yPct) {
    savedPosition = { xPct, yPct };
    localStorage.setItem(AppConfig.positionKey, JSON.stringify(savedPosition));
}

function loadPositionLocked() {
    try {
        return localStorage.getItem(AppConfig.positionLockKey) === "1";
    } catch {
        return false;
    }
}

function savePositionLocked(locked) {
    positionLocked = locked;
    try {
        localStorage.setItem(AppConfig.positionLockKey, locked ? "1" : "0");
    } catch {
        /* ignore */
    }
}

function clampPositionPx(x, y, width, height) {
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

function applyCardPosition(collapsed) {
    const card = document.getElementById("calendar-card");
    if (!card) return;

    if (collapsed) {
        card.classList.remove("centered");
        const pos = savedPosition || { xPct: 50, yPct: 50 };
        card.style.setProperty("--card-x", `${pos.xPct}%`);
        card.style.setProperty("--card-y", `${pos.yPct}%`);
    } else {
        card.classList.add("centered");
        card.style.removeProperty("--card-x");
        card.style.removeProperty("--card-y");
    }
}

function initPosition() {
    savedPosition = loadSavedPosition();
    positionLocked = loadPositionLocked();
    const card = document.getElementById("calendar-card");
    const header = card?.querySelector(".calendar-header");
    const lockBtn = document.getElementById("position-lock-btn");
    if (!card || !header) return;

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
        const nextX = dragStart.centerX + point.x - dragStart.pointerX;
        const nextY = dragStart.centerY + point.y - dragStart.pointerY;
        const clamped = clampPositionPx(nextX, nextY, dragStart.width, dragStart.height);
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
            /* CEF may drop capture before pointerup */
        }
    }

    header.addEventListener("pointerdown", (e) => {
        if (!card.classList.contains("collapsed")) return;
        if (positionLocked) return;
        if (e.target.closest("button, a, input, select, textarea")) return;

        const rect = card.getBoundingClientRect();
        isDragging = true;
        activePointerId = e.pointerId;
        dragStart = {
            pointerX: e.clientX,
            pointerY: e.clientY,
            centerX: rect.left + rect.width / 2,
            centerY: rect.top + rect.height / 2,
            width: rect.width,
            height: rect.height
        };

        try {
            header.setPointerCapture(e.pointerId);
        } catch {
            /* Pointer capture is best-effort in Wallpaper Engine CEF */
        }
        header.classList.add("dragging");
        card.classList.add("dragging");
        window.addEventListener("pointermove", moveDrag);
        window.addEventListener("pointerup", endDrag);
        window.addEventListener("pointercancel", endDrag);
        window.addEventListener("blur", endDrag);
        e.preventDefault();
    });
}

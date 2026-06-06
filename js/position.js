let savedPosition = null;
let isDragging = false;

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

function clampPosition(xPct, yPct) {
    const margin = 8;
    return {
        xPct: Math.min(100 - margin, Math.max(margin, xPct)),
        yPct: Math.min(100 - margin, Math.max(margin, yPct))
    };
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
    const card = document.getElementById("calendar-card");
    const header = card?.querySelector(".calendar-header");
    if (!card || !header) return;

    header.addEventListener("pointerdown", (e) => {
        if (!card.classList.contains("collapsed")) return;
        if (e.target.closest("button, a, input, select, textarea")) return;

        isDragging = true;
        header.setPointerCapture(e.pointerId);
        header.classList.add("dragging");
        card.classList.add("dragging");
        e.preventDefault();
    });

    header.addEventListener("pointermove", (e) => {
        if (!isDragging) return;

        const xPct = (e.clientX / window.innerWidth) * 100;
        const yPct = (e.clientY / window.innerHeight) * 100;
        const clamped = clampPosition(xPct, yPct);

        card.style.setProperty("--card-x", `${clamped.xPct}%`);
        card.style.setProperty("--card-y", `${clamped.yPct}%`);
    });

    const endDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;
        header.classList.remove("dragging");
        card.classList.remove("dragging");

        const xPct = parseFloat(card.style.getPropertyValue("--card-x")) || 50;
        const yPct = parseFloat(card.style.getPropertyValue("--card-y")) || 50;
        savePosition(xPct, yPct);

        if (header.hasPointerCapture(e.pointerId)) {
            header.releasePointerCapture(e.pointerId);
        }
    };

    header.addEventListener("pointerup", endDrag);
    header.addEventListener("pointercancel", endDrag);
}

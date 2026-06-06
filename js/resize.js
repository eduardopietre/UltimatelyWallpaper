let savedCardSize = null;
let isResizingCard = false;
let resizeStart = null;

const CARD_ASPECT_RATIO = 920 / 680;
const CARD_MIN_WIDTH = 560;
const CARD_MIN_HEIGHT = CARD_MIN_WIDTH / CARD_ASPECT_RATIO;

function loadSavedCardSize() {
    try {
        const raw = localStorage.getItem(AppConfig.sizeKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed.width === "number" && typeof parsed.height === "number") {
            return parsed;
        }
    } catch {
        /* ignore */
    }
    return null;
}

function clampCardSize(width) {
    const maxWidth = Math.max(CARD_MIN_WIDTH, window.innerWidth * 0.94);
    const maxHeight = Math.max(CARD_MIN_HEIGHT, window.innerHeight * 0.88);
    let nextWidth = Math.min(maxWidth, Math.max(CARD_MIN_WIDTH, width));
    let nextHeight = nextWidth / CARD_ASPECT_RATIO;

    if (nextHeight > maxHeight) {
        nextHeight = maxHeight;
        nextWidth = nextHeight * CARD_ASPECT_RATIO;
    }

    return {
        width: Math.round(nextWidth),
        height: Math.round(nextHeight)
    };
}

function saveCardSize(size) {
    savedCardSize = size;
    try {
        localStorage.setItem(AppConfig.sizeKey, JSON.stringify(size));
    } catch {
        /* ignore */
    }
}

function applyCardSize(size) {
    const card = document.getElementById("calendar-card");
    if (!card) return;
    card.style.setProperty("--card-width", `${size.width}px`);
    card.style.setProperty("--card-height", `${size.height}px`);
}

function clearExpandedCardSize() {
    const card = document.getElementById("calendar-card");
    if (!card) return;
    card.style.removeProperty("--card-height");
}

function applyCardSizeForState(collapsed) {
    if (collapsed) {
        clearExpandedCardSize();
        return;
    }

    const size = savedCardSize || clampCardSize(920);
    applyCardSize(clampCardSize(size.width));
}

function initResize() {
    savedCardSize = loadSavedCardSize();
    const card = document.getElementById("calendar-card");
    const handle = document.getElementById("calendar-resize-handle");
    if (!card || !handle) return;

    applyCardSizeForState(card.classList.contains("collapsed"));

    handle.addEventListener("pointerdown", (e) => {
        if (card.classList.contains("collapsed")) return;

        isResizingCard = true;
        resizeStart = {
            x: e.clientX,
            y: e.clientY,
            width: card.getBoundingClientRect().width
        };
        handle.setPointerCapture(e.pointerId);
        card.classList.add("resizing");
        e.preventDefault();
        e.stopPropagation();
    });

    handle.addEventListener("pointermove", (e) => {
        if (!isResizingCard || !resizeStart) return;

        const delta = Math.max(e.clientX - resizeStart.x, (e.clientY - resizeStart.y) * CARD_ASPECT_RATIO);
        const nextSize = clampCardSize(resizeStart.width + delta);
        applyCardSize(nextSize);
    });

    const endResize = (e) => {
        if (!isResizingCard) return;
        isResizingCard = false;
        resizeStart = null;
        card.classList.remove("resizing");

        const rect = card.getBoundingClientRect();
        saveCardSize(clampCardSize(rect.width));

        if (handle.hasPointerCapture(e.pointerId)) {
            handle.releasePointerCapture(e.pointerId);
        }
    };

    handle.addEventListener("pointerup", endResize);
    handle.addEventListener("pointercancel", endResize);
    window.addEventListener("resize", () => {
        if (card.classList.contains("collapsed")) return;
        const size = savedCardSize || clampCardSize(card.getBoundingClientRect().width);
        const clamped = clampCardSize(size.width);
        saveCardSize(clamped);
        applyCardSize(clamped);
    });
}

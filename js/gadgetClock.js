/**
 * Clock gadget: large time + date, draggable and freely resizable. The 12h/24h
 * choice persists in `clockPrefs`; position/size in `clockPosition`/`clockSize`.
 */

let clockPrefs = { use24h: true };
let clockTimer = null;

const CLOCK_DEFAULT_SIZE = { width: 280, height: 150 };
const CLOCK_MIN = { width: 180, height: 110 };

function loadClockPrefs() {
    try {
        const raw = readPersistentStorage("clockPrefs");
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed.use24h === "boolean") {
            clockPrefs = parsed;
        } else {
            clockPrefs = { use24h: !!AppConfig.use24Hour };
        }
    } catch {
        clockPrefs = { use24h: !!AppConfig.use24Hour };
    }
}

function saveClockPrefs() {
    writePersistentStorage("clockPrefs", JSON.stringify(clockPrefs));
}

function clampClockSize(width, height) {
    const maxWidth = Math.max(CLOCK_MIN.width, window.innerWidth * 0.6);
    const maxHeight = Math.max(CLOCK_MIN.height, window.innerHeight * 0.6);
    return {
        width: Math.round(Math.min(maxWidth, Math.max(CLOCK_MIN.width, width))),
        height: Math.round(Math.min(maxHeight, Math.max(CLOCK_MIN.height, height)))
    };
}

function applyClockPosition(card) {
    try {
        const raw = readPersistentStorage("clockPosition");
        const pos = raw ? JSON.parse(raw) : null;
        if (pos && typeof pos.xPct === "number") {
            card.style.setProperty("--clock-x", `${pos.xPct}%`);
            card.style.setProperty("--clock-y", `${pos.yPct}%`);
        }
    } catch {
        /* ignore */
    }
}

function applyClockSize(card) {
    let size = CLOCK_DEFAULT_SIZE;
    try {
        const raw = readPersistentStorage("clockSize");
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed.width === "number") size = parsed;
    } catch {
        /* ignore */
    }
    const clamped = clampClockSize(size.width, size.height);
    card.style.setProperty("--clock-width", `${clamped.width}px`);
    card.style.setProperty("--clock-height", `${clamped.height}px`);
}

function updateClockGadget() {
    const card = document.getElementById("clock-gadget");
    if (!card || card.classList.contains("hidden")) return;
    const timeEl = card.querySelector(".clock-time");
    const dateEl = card.querySelector(".clock-date");
    if (!timeEl || !dateEl) return;

    const now = new Date();
    const timeOpts = clockPrefs.use24h
        ? { hour: "2-digit", minute: "2-digit", hour12: false }
        : { hour: "numeric", minute: "2-digit", hour12: true };
    timeEl.textContent = now.toLocaleTimeString(undefined, timeOpts);
    dateEl.textContent = now.toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long"
    });
}

function updateClockFormatButton(btn) {
    if (!btn) return;
    const label = clockPrefs.use24h ? "24h" : "12h";
    btn.textContent = label;
    const title = `Switch to ${clockPrefs.use24h ? "12-hour" : "24-hour"} format`;
    btn.title = title;
    btn.setAttribute("aria-label", title);
}

function buildClockGadget() {
    const card = document.createElement("div");
    card.id = "clock-gadget";
    card.className = "clock-gadget gadget hidden";

    const header = document.createElement("div");
    header.className = "gadget-header clock-header";

    const formatBtn = document.createElement("button");
    formatBtn.type = "button";
    formatBtn.className = "gadget-btn gadget-btn-ghost clock-format-btn";
    formatBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        clockPrefs.use24h = !clockPrefs.use24h;
        saveClockPrefs();
        updateClockFormatButton(formatBtn);
        updateClockGadget();
    });

    const closeBtn = createIconButton({
        icon: "close-small",
        title: "Hide clock",
        className: "gadget-close",
        onClick: () => Gadgets.setVisible("clock", false)
    });

    header.appendChild(formatBtn);
    header.appendChild(closeBtn);

    const time = document.createElement("div");
    time.className = "clock-time";
    time.textContent = "--:--";

    const date = document.createElement("div");
    date.className = "clock-date";

    const handle = document.createElement("div");
    handle.className = "gadget-resize-handle";
    handle.setAttribute("aria-hidden", "true");

    card.appendChild(header);
    card.appendChild(time);
    card.appendChild(date);
    card.appendChild(handle);
    document.body.appendChild(card);

    updateClockFormatButton(formatBtn);
    return card;
}

function initClockGadget() {
    if (document.getElementById("clock-gadget")) return;
    loadClockPrefs();
    const card = buildClockGadget();
    applyClockPosition(card);
    applyClockSize(card);

    makeDraggable({
        el: card,
        handle: card,
        xVar: "--clock-x",
        yVar: "--clock-y",
        save: (xPct, yPct) => writePersistentStorage("clockPosition", JSON.stringify({ xPct, yPct, anchor: "topleft" })),
        defaultXPct: 40,
        defaultYPct: 40
    });

    makeResizable({
        el: card,
        handle: card.querySelector(".gadget-resize-handle"),
        wVar: "--clock-width",
        hVar: "--clock-height",
        clamp: (width, height) => clampClockSize(width, height),
        save: (size) => writePersistentStorage("clockSize", JSON.stringify(size))
    });

    Gadgets.register({
        id: "clock",
        el: card,
        defaultVisible: false,
        onShow: () => updateClockGadget()
    });

    updateClockGadget();
    if (clockTimer) window.clearInterval(clockTimer);
    clockTimer = window.setInterval(updateClockGadget, AppConfig.clockIntervalMs);
}

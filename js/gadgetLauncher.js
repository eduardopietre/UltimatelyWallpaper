/**
 * Launcher dock: the only element shown by default. A small draggable bar of
 * icon buttons that open settings and toggle the visibility of every gadget
 * registered with the Gadgets registry (gadgets.js).
 */

let launcherDraggable = null;

const LAUNCHER_BUTTONS = [
    { id: "config", icon: "cog", title: "Settings", action: "settings" },
    { id: "calendar", icon: "calendar", title: "Calendar" },
    { id: "notes", icon: "clipboard-list", title: "Notes" },
    { id: "clock", icon: "watch", title: "Clock" },
    { id: "pomodoro", icon: "coffee", title: "Pomodoro" },
    { id: "links", icon: "link", title: "Quick links" },
    { id: "media", icon: "volume-high", title: "Now playing" },
    { id: "monitor", icon: "gauge", title: "System monitor" }
];

function loadLauncherPosition() {
    try {
        const raw = readPersistentStorage("launcherPosition");
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

function saveLauncherPosition(xPct, yPct) {
    writePersistentStorage("launcherPosition", JSON.stringify({ xPct, yPct, anchor: "topleft" }));
}

function applyLauncherPosition(bar) {
    const pos = loadLauncherPosition();
    if (!pos) return;
    bar.style.setProperty("--launcher-x", `${pos.xPct}%`);
    bar.style.setProperty("--launcher-y", `${pos.yPct}%`);
}

function buildLauncher() {
    const bar = document.createElement("div");
    bar.id = "gadget-launcher";
    bar.className = "gadget-launcher";

    LAUNCHER_BUTTONS.forEach((cfg) => {
        const btn = createIconButton({
            icon: cfg.icon,
            title: cfg.title,
            className: "launcher-btn",
            id: `launcher-${cfg.id}-btn`,
            onClick: () => {
                if (cfg.action === "settings") {
                    if (typeof openSettingsPanel === "function") openSettingsPanel();
                    return;
                }
                Gadgets.toggle(cfg.id);
            }
        });
        bar.appendChild(btn);
        if (cfg.action !== "settings") {
            Gadgets.bindLauncherButton(cfg.id, btn);
        }
    });

    document.body.appendChild(bar);
    return bar;
}

function initLauncher() {
    if (document.getElementById("gadget-launcher")) return;
    const bar = buildLauncher();
    applyLauncherPosition(bar);

    launcherDraggable = makeDraggable({
        el: bar,
        handle: bar,
        xVar: "--launcher-x",
        yVar: "--launcher-y",
        save: saveLauncherPosition,
        defaultXPct: 1.5,
        defaultYPct: 1.5
    });
}

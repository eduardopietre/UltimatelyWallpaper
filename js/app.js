function updateClock() {
    const el = document.getElementById("header-clock");
    if (!el) return;
    const now = new Date();
    const opts = AppConfig.use24Hour
        ? { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }
        : { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true };
    el.textContent = now.toLocaleTimeString(undefined, opts);
}

function setCollapsed(collapsed, persist = true) {
    const card = document.getElementById("calendar-card");
    const btn = document.getElementById("collapse-btn");
    if (!card || !btn) return;

    card.classList.toggle("collapsed", collapsed);
    btn.textContent = collapsed ? "+" : "−";
    if (persist) {
        localStorage.setItem(AppConfig.collapsedKey, collapsed ? "1" : "0");
    }
}

function initCollapse() {
    const stored = localStorage.getItem(AppConfig.collapsedKey);
    const collapsed = stored !== null ? stored === "1" : AppConfig.startCollapsed;
    setCollapsed(collapsed, false);

    document.getElementById("collapse-btn").addEventListener("click", () => {
        const card = document.getElementById("calendar-card");
        setCollapsed(!card.classList.contains("collapsed"));
    });
}

function initViewTabs() {
    document.querySelectorAll(".view-tab").forEach((tab) => {
        tab.addEventListener("click", () => setView(tab.dataset.view));
    });
}

function initApp() {
    applyBackground();
    applyCalendarBackground();
    initCollapse();
    initViewTabs();
    setView(AppConfig.defaultView);
    updateClock();
    setInterval(updateClock, AppConfig.clockIntervalMs);
    startPolling();
}

document.addEventListener("DOMContentLoaded", initApp);

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
    if (collapsed && typeof isEventFormVisible === "function" && isEventFormVisible()) {
        closeEventForm();
    }
    if (typeof applyCardPosition === "function") {
        applyCardPosition(collapsed);
    }
    if (typeof applyCardSizeForState === "function") {
        applyCardSizeForState(collapsed);
    }
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
    const select = document.getElementById("view-select");
    if (select) {
        select.addEventListener("change", () => setView(select.value));
        return;
    }

    document.querySelectorAll(".view-tab").forEach((tab) => {
        tab.addEventListener("click", () => setView(tab.dataset.view));
    });
}

function initSyncButton() {
    const btn = document.getElementById("sync-btn");
    if (!btn || typeof triggerSync !== "function") return;
    btn.addEventListener("click", () => triggerSync(btn));
}

function initApp() {
    if (typeof loadWallpaperPrefs === "function") loadWallpaperPrefs();
    applyBackground();
    applyCalendarBackground();
    initPosition();
    if (typeof initResize === "function") initResize();
    initCollapse();
    initViewTabs();
    initMonthNav();
    initSyncButton();
    if (typeof initSettingsPanel === "function") initSettingsPanel();
    if (typeof initWallpaperPicker === "function") initWallpaperPicker();
    if (typeof initEventForm === "function") initEventForm();
    setView(AppConfig.defaultView);
    updateClock();
    setInterval(updateClock, AppConfig.clockIntervalMs);
    startPolling();
}

function initGlobalErrorHandlers() {
    window.addEventListener("unhandledrejection", (event) => {
        event.preventDefault();
        console.error("Unhandled promise rejection:", event.reason);
        if (typeof updateSyncStatus === "function") {
            updateSyncStatus("An error occurred, check sync service");
        }
    });

    window.addEventListener("error", (event) => {
        console.error("Unhandled error:", event.error || event.message);
        event.preventDefault();
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initGlobalErrorHandlers();
    initApp();
});

const AppConfig = {
    syncPort: 8765,
    pollIntervalMs: 5 * 60 * 1000,
    healthIntervalMs: 5 * 60 * 1000,
    clockIntervalMs: 1000,
    cacheKey: "icloudCalendarCache",
    collapsedKey: "calendarCollapsed",
    positionKey: "calendarPosition",
    sizeKey: "calendarSize",
    wallpaperPrefsKey: "wallpaperPrefs",
    lastCalendarIdKey: "lastCalendarId",
    defaultView: "month",
    weekStart: 0,
    use24Hour: true,
    showOfflineBadge: true,
    calendarFilter: [],
    calendarColor: "#101318",
    calendarAlpha: 0.85,
    accentColor: "#3a588e",
    fontFamily: "Segoe UI, system-ui, sans-serif",
    bgType: "1",
    bgColor: "#1b1b1b",
    bgImage: "",
    bgBlur: 0,
    bgBrightness: 100,
    startCollapsed: false
};

function parseCalendarFilter(raw) {
    if (!raw || !raw.trim()) return [];
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function hexToRgb(hex) {
    const h = hex.replace("#", "");
    if (h.length !== 6) return { r: 16, g: 19, b: 24 };
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16)
    };
}

function applyCalendarBackground() {
    const card = document.getElementById("calendar-card");
    if (!card) return;
    const { r, g, b } = hexToRgb(AppConfig.calendarColor);
    card.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${AppConfig.calendarAlpha})`;
    document.documentElement.style.setProperty("--accent-color", AppConfig.accentColor);
    document.body.style.fontFamily = AppConfig.fontFamily;
}

function getSyncBaseUrl() {
    return `http://127.0.0.1:${AppConfig.syncPort}`;
}

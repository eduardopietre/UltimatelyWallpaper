window.wallpaperPropertyListener = {
    applyUserProperties(properties) {
        if (properties.syncPort) {
            const port = parseInt(properties.syncPort.value, 10);
            if (!isNaN(port) && port > 0) AppConfig.syncPort = port;
        }
        if (properties.showOfflineBadge) {
            AppConfig.showOfflineBadge = properties.showOfflineBadge.value;
        }
        if (properties.calendarFilter) {
            AppConfig.calendarFilter = parseCalendarFilter(properties.calendarFilter.value);
            calendarData.events = filterEvents(calendarData.events || []);
        }
        if (properties.calendarColor) {
            AppConfig.calendarColor = properties.calendarColor.value;
        }
        if (properties.calendarAlpha) {
            AppConfig.calendarAlpha = properties.calendarAlpha.value;
        }
        if (properties.accentColor) {
            AppConfig.accentColor = properties.accentColor.value;
        }
        if (properties.weekStart) {
            AppConfig.weekStart = parseInt(properties.weekStart.value, 10) || 0;
        }
        if (properties.clockFormat) {
            AppConfig.use24Hour = properties.clockFormat.value;
        }
        if (properties.fontChoice) {
            const fonts = {
                "1": "Segoe UI, system-ui, sans-serif",
                "2": "Segoe UI, sans-serif",
                "3": "Consolas, monospace"
            };
            AppConfig.fontFamily = fonts[properties.fontChoice.value] || fonts["1"];
        }
        if (properties.startCollapsed !== undefined) {
            AppConfig.startCollapsed = properties.startCollapsed.value;
            if (typeof setCollapsed === "function") {
                setCollapsed(properties.startCollapsed.value, false);
            }
        }
        if (properties.viewMode) {
            AppConfig.defaultView = viewModeFromWeValue(properties.viewMode.value);
            if (typeof setView === "function") setView(AppConfig.defaultView);
        }

        setBackgroundFromProperties(properties);
        applyCalendarBackground();

        if (typeof renderCurrentView === "function") renderCurrentView();
        if (typeof updateClock === "function") updateClock();
    }
};

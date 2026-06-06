function loadWallpaperPrefs() {
    try {
        const raw = localStorage.getItem(AppConfig.wallpaperPrefsKey);
        if (!raw) return;
        const prefs = JSON.parse(raw);
        if (prefs.bgType) AppConfig.bgType = prefs.bgType;
        if (prefs.bgImage !== undefined) AppConfig.bgImage = prefs.bgImage;
        if (prefs.bgColor) AppConfig.bgColor = prefs.bgColor;
    } catch {
        /* ignore */
    }
}

function saveWallpaperPrefs() {
    try {
        localStorage.setItem(
            AppConfig.wallpaperPrefsKey,
            JSON.stringify({
                bgType: AppConfig.bgType,
                bgImage: AppConfig.bgImage,
                bgColor: AppConfig.bgColor
            })
        );
    } catch {
        if (typeof updateSyncStatus === "function") {
            updateSyncStatus("Wallpaper too large to save — image not persisted");
        }
    }
}

function initWallpaperPicker() {
    const btn = document.getElementById("wallpaper-btn");
    const fileInput = document.getElementById("wallpaper-file");
    const solidBtn = document.getElementById("wallpaper-solid-btn");
    if (!btn || !fileInput) return;

    btn.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            AppConfig.bgType = "2";
            AppConfig.bgImage = reader.result;
            applyBackground();
            saveWallpaperPrefs();
        };
        reader.onerror = () => {
            if (typeof updateSyncStatus === "function") {
                updateSyncStatus("Failed to read wallpaper image");
            }
        };
        reader.readAsDataURL(file);
        fileInput.value = "";
    });

    if (solidBtn) {
        solidBtn.addEventListener("click", () => {
            AppConfig.bgType = "1";
            AppConfig.bgImage = "";
            applyBackground();
            saveWallpaperPrefs();
        });
    }
}

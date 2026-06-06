function applyBackground() {
    const el = document.getElementById("wallpaper-bg");
    if (!el) return;

    const brightness = AppConfig.bgBrightness / 100;
    el.style.filter = `blur(${AppConfig.bgBlur}px) brightness(${brightness})`;

    if (AppConfig.bgType === "2" && AppConfig.bgImage) {
        el.style.backgroundColor = "";
        el.style.backgroundImage = `url("${AppConfig.bgImage}")`;
    } else {
        el.style.backgroundImage = "";
        el.style.backgroundColor = AppConfig.bgColor;
    }
}

function setBackgroundFromProperties(properties) {
    if (properties.bgType) AppConfig.bgType = properties.bgType.value;
    if (properties.bgColor) AppConfig.bgColor = properties.bgColor.value;
    if (properties.bgImage) AppConfig.bgImage = properties.bgImage.value || "";
    if (properties.bgBlur) AppConfig.bgBlur = properties.bgBlur.value;
    if (properties.bgBrightness) AppConfig.bgBrightness = properties.bgBrightness.value;
    applyBackground();
}

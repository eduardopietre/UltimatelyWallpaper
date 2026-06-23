const Icons = (() => {
    const ICON_PATH = "line-md-svg/css.json";
    const DEFAULT_ICONS = [
        "security", "security-off", "cog", "plus", "minus", "chevron-left", "chevron-right",
        "close-small", "close", "trash", "pencil", "cloud-alt-upload", "arrow-up", "arrow-down",
        "list-indented", "list-indented-reversed", "external-link", "calendar"
    ];

    let data = null;
    let ready = null;
    const usedIcons = new Set(DEFAULT_ICONS);

    function resolveRef(value, list) {
        if (typeof value === "number") {
            return list[value] ?? "";
        }
        return value ?? "";
    }

    function resolveIconName(name) {
        if (!data || !name) return name;
        return data.aliases?.[name] || name;
    }

    function getViewBox(icon) {
        const boxes = data.viewBoxes || ["0 0 24 24"];
        const index = icon.viewBox;
        if (typeof index === "number") {
            return boxes[index] || boxes[0];
        }
        if (typeof index === "string") {
            return index;
        }
        if (index && typeof index === "object") {
            const left = index.left ?? 0;
            const top = index.top ?? 0;
            const width = index.width ?? 24;
            const height = index.height ?? 24;
            return `${left} ${top} ${width} ${height}`;
        }
        return boxes[0];
    }

    function collectClassesFromContent(content) {
        const classes = new Set();
        const pattern = /class="([^"]+)"/g;
        let match;
        while ((match = pattern.exec(content)) !== null) {
            for (const className of match[1].split(/\s+/)) {
                if (className) classes.add(className);
            }
        }
        return classes;
    }

    function collectClassesForIcon(name) {
        const icon = data.icons?.[resolveIconName(name)];
        if (!icon) return new Set();
        return collectClassesFromContent(icon.content || "");
    }

    function collectKeyframes(animationRules) {
        const names = new Set();
        const keyframes = data.keyframes || {};
        for (const rule of animationRules) {
            if (!rule) continue;
            for (const key of Object.keys(keyframes)) {
                if (rule.includes(key)) {
                    names.add(key);
                }
            }
        }
        return names;
    }

    function buildStylesheet() {
        const classNames = new Set();
        for (const iconName of usedIcons) {
            for (const className of collectClassesForIcon(iconName)) {
                classNames.add(className);
            }
        }

        const ruleBlocks = [];
        const animationBlocks = [];
        const animationRules = [];

        for (const className of classNames) {
            const entry = data.classes?.[className];
            if (!entry) continue;

            const rule = resolveRef(entry.r, data.css.r);
            const animation = entry.a !== undefined ? resolveRef(entry.a, data.css.a) : "";

            if (rule) {
                ruleBlocks.push(`.${className}{${rule}}`);
            }
            if (animation) {
                animationBlocks.push(`.${className}{${animation}}`);
                animationRules.push(animation);
            }
        }

        const keyframeBlocks = [];
        for (const name of collectKeyframes(animationRules)) {
            const body = data.keyframes[name];
            if (body) {
                keyframeBlocks.push(`@keyframes ${name}{${body}}`);
            }
        }

        const parts = [
            ruleBlocks.join(""),
            keyframeBlocks.join(""),
            animationBlocks.length
                ? `@media not (prefers-reduced-motion){${animationBlocks.join("")}}`
                : ""
        ];
        return parts.join("");
    }

    function injectStyles() {
        if (document.getElementById("line-md-icon-styles")) return;
        const style = document.createElement("style");
        style.id = "line-md-icon-styles";
        style.textContent = buildStylesheet();
        document.head.appendChild(style);
    }

    function ensureIcon(name) {
        const resolved = resolveIconName(name);
        if (!data?.icons?.[resolved]) return null;
        if (!usedIcons.has(resolved)) {
            usedIcons.add(resolved);
            const style = document.getElementById("line-md-icon-styles");
            if (style) {
                style.textContent = buildStylesheet();
            }
        }
        return data.icons[resolved];
    }

    function svg(name) {
        if (!data) return "";
        const icon = ensureIcon(name);
        if (!icon) return "";
        const viewBox = getViewBox(icon);
        return `<svg viewBox="${viewBox}" class="line-md-icon" aria-hidden="true">${icon.content}</svg>`;
    }

    function set(element, name) {
        if (!element) return;
        element.innerHTML = svg(name);
    }

    function setLabel(element, name, label) {
        if (!element) return;
        element.innerHTML = `${svg(name)}<span class="icon-label">${label}</span>`;
    }

    function setLock(element, locked) {
        set(element, locked ? "security" : "security-off");
    }

    function setCollapse(element, collapsed) {
        set(element, collapsed ? "plus" : "minus");
    }

    async function init() {
        if (ready) return ready;
        ready = fetch(ICON_PATH)
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Failed to load icons: ${response.status}`);
                }
                return response.json();
            })
            .then((json) => {
                data = json;
                injectStyles();
            })
            .catch((err) => {
                ready = null;
                console.error(err);
                throw err;
            });
        return ready;
    }

    return {
        init,
        svg,
        set,
        setLabel,
        setLock,
        setCollapse
    };
})();

const TOOLTIP_ATTR = "data-tooltip-title";

let tooltipsEnabled = true;
let tooltipObserver = null;

function stashElementTooltip(el) {
    if (!(el instanceof Element)) return;
    const title = el.getAttribute("title");
    if (!title) return;
    el.setAttribute(TOOLTIP_ATTR, title);
    el.removeAttribute("title");
}

function restoreElementTooltip(el) {
    if (!(el instanceof Element)) return;
    const stored = el.getAttribute(TOOLTIP_ATTR);
    if (stored === null) return;
    if (!el.getAttribute("title")) {
        el.setAttribute("title", stored);
    }
    el.removeAttribute(TOOLTIP_ATTR);
}

function stashAllTooltips(root = document) {
    root.querySelectorAll("[title]").forEach(stashElementTooltip);
}

function restoreAllTooltips(root = document) {
    root.querySelectorAll(`[${TOOLTIP_ATTR}]`).forEach(restoreElementTooltip);
}

function setNativeTooltipsEnabled(enabled) {
    if (enabled === tooltipsEnabled) return;
    tooltipsEnabled = enabled;
    if (enabled) {
        restoreAllTooltips();
    } else {
        stashAllTooltips();
    }
}

function syncTooltipFocusState() {
    setNativeTooltipsEnabled(document.hasFocus() && !document.hidden);
}

function observeTooltipMutations() {
    if (tooltipObserver) return;
    tooltipObserver = new MutationObserver((mutations) => {
        if (tooltipsEnabled) return;
        for (const mutation of mutations) {
            if (mutation.type === "attributes" && mutation.attributeName === "title") {
                stashElementTooltip(mutation.target);
                continue;
            }
            if (mutation.type !== "childList") continue;
            mutation.addedNodes.forEach((node) => {
                if (!(node instanceof Element)) return;
                stashElementTooltip(node);
                node.querySelectorAll("[title]").forEach(stashElementTooltip);
            });
        }
    });
    tooltipObserver.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["title"]
    });
}

function initTooltipFocusGuard() {
    observeTooltipMutations();
    window.addEventListener("focus", syncTooltipFocusState);
    window.addEventListener("blur", syncTooltipFocusState);
    document.addEventListener("visibilitychange", syncTooltipFocusState);
    syncTooltipFocusState();
}

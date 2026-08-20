/**
 * Shared gadget framework: drag/resize/lock/collapse helpers, an icon-button
 * factory, and a lightweight registry that tracks each gadget's visibility.
 *
 * All persistence goes through writePersistentStorage/readPersistentStorage
 * (persistence.js). Position values are stored as percentages of the viewport
 * so layouts survive resolution changes, matching the existing calendar/notes
 * behaviour this module replaces.
 */

const GADGET_DRAG_SKIP_SELECTOR = "button, a, input, select, textarea, .custom-select";

function clampTopLeftPx(x, y, width, height, margin = 8) {
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    let clampedX;
    let clampedY;

    if (width + margin * 2 <= viewW) {
        clampedX = Math.min(viewW - width - margin, Math.max(margin, x));
    } else {
        clampedX = Math.max(margin, (viewW - width) / 2);
    }

    if (height + margin * 2 <= viewH) {
        clampedY = Math.min(viewH - height - margin, Math.max(margin, y));
    } else {
        clampedY = Math.max(margin, (viewH - height) / 2);
    }

    return { x: clampedX, y: clampedY };
}

function pxToPct(x, y) {
    return {
        xPct: (x / window.innerWidth) * 100,
        yPct: (y / window.innerHeight) * 100
    };
}

/**
 * Pull a gadget back inside the viewport and persist the corrected position.
 * A saved layout can land off-screen after a resolution change or a monitor
 * being unplugged, which otherwise looks exactly like "the gadget did not come
 * back". Only runs while the gadget is laid out (a hidden element has no box).
 */
function ensureGadgetOnScreen({ el, xVar, yVar, save }) {
    if (!el || el.classList.contains("hidden")) return;
    if (el.classList.contains("dragging") || el.classList.contains("resizing")) return;

    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const clamped = clampTopLeftPx(rect.left, rect.top, rect.width, rect.height);
    if (Math.abs(clamped.x - rect.left) < 0.5 && Math.abs(clamped.y - rect.top) < 0.5) return;

    const pct = pxToPct(clamped.x, clamped.y);
    el.style.setProperty(xVar, `${pct.xPct}%`);
    el.style.setProperty(yVar, `${pct.yPct}%`);
    if (typeof save === "function") save(pct.xPct, pct.yPct);
}

/**
 * Wire pointer-based dragging on `el` using `handle` as the grab area.
 * Writes `xVar`/`yVar` CSS custom properties (percentages) live and calls
 * `save(xPct, yPct)` when a drag ends. Returns { cancel, isDragging }.
 */
function makeDraggable({
    el,
    handle,
    xVar,
    yVar,
    save,
    isLocked,
    skipSelector = GADGET_DRAG_SKIP_SELECTOR,
    defaultXPct = 50,
    defaultYPct = 8
}) {
    if (!el || !handle) return { cancel() {}, isDragging: () => false };

    let dragging = false;
    let activePointerId = null;
    let dragStart = null;
    let pendingFrame = null;
    let pendingPoint = null;

    function applyPoint(point) {
        if (!dragStart) return;
        const nextX = dragStart.anchorX + point.x - dragStart.pointerX;
        const nextY = dragStart.anchorY + point.y - dragStart.pointerY;
        const clamped = clampTopLeftPx(nextX, nextY, dragStart.width, dragStart.height);
        const pct = pxToPct(clamped.x, clamped.y);
        el.style.setProperty(xVar, `${pct.xPct}%`);
        el.style.setProperty(yVar, `${pct.yPct}%`);
    }

    function scheduleMove(point) {
        pendingPoint = point;
        if (pendingFrame) return;
        pendingFrame = window.requestAnimationFrame(() => {
            pendingFrame = null;
            if (pendingPoint) applyPoint(pendingPoint);
        });
    }

    function moveDrag(e) {
        if (!dragging || e.pointerId !== activePointerId) return;
        scheduleMove({ x: e.clientX, y: e.clientY });
        e.preventDefault();
    }

    function finish(persist) {
        if (!dragging) return;
        if (pendingFrame) {
            window.cancelAnimationFrame(pendingFrame);
            pendingFrame = null;
        }
        if (pendingPoint) {
            applyPoint(pendingPoint);
            pendingPoint = null;
        }

        const pointerId = activePointerId;
        dragging = false;
        activePointerId = null;
        dragStart = null;
        el.classList.remove("dragging");
        handle.classList.remove("dragging");

        if (persist && typeof save === "function") {
            const xPct = parseFloat(el.style.getPropertyValue(xVar)) || defaultXPct;
            const yPct = parseFloat(el.style.getPropertyValue(yVar)) || defaultYPct;
            save(xPct, yPct);
        }

        window.removeEventListener("pointermove", moveDrag);
        window.removeEventListener("pointerup", endDrag);
        window.removeEventListener("pointercancel", endDrag);
        window.removeEventListener("blur", endDrag);

        try {
            if (pointerId !== null && handle.hasPointerCapture(pointerId)) {
                handle.releasePointerCapture(pointerId);
            }
        } catch {
            /* Embedded webview may drop capture before pointerup */
        }
    }

    function endDrag(e) {
        if (e && activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) {
            return;
        }
        finish(true);
    }

    handle.addEventListener("pointerdown", (e) => {
        if (typeof isLocked === "function" && isLocked()) return;
        if (e.target.closest(skipSelector)) return;

        const rect = el.getBoundingClientRect();
        dragging = true;
        activePointerId = e.pointerId;
        dragStart = {
            pointerX: e.clientX,
            pointerY: e.clientY,
            anchorX: rect.left,
            anchorY: rect.top,
            width: rect.width,
            height: rect.height
        };

        try {
            handle.setPointerCapture(e.pointerId);
        } catch {
            /* Pointer capture is best-effort in the Lively webview */
        }
        el.classList.add("dragging");
        handle.classList.add("dragging");
        window.addEventListener("pointermove", moveDrag);
        window.addEventListener("pointerup", endDrag);
        window.addEventListener("pointercancel", endDrag);
        window.addEventListener("blur", endDrag);
        e.preventDefault();
    });

    return {
        cancel: () => finish(false),
        isDragging: () => dragging
    };
}

/**
 * Wire corner-handle resizing on `el`. When `aspect` is provided the width/
 * height stay locked to that ratio (calendar); otherwise width and height are
 * independent (notes and free-form gadgets). `clamp(width, height)` bounds the
 * result, `save(size)` persists it, and `onResize(size)` runs on every frame.
 */
function makeResizable({
    el,
    handle,
    wVar,
    hVar,
    aspect,
    clamp,
    save,
    disabled,
    onResize
}) {
    if (!el || !handle) return;

    let resizing = false;
    let resizeStart = null;

    function computeSize(dx, dy) {
        let width;
        let height;
        if (aspect) {
            const delta = Math.max(dx, dy * aspect);
            width = resizeStart.width + delta;
            height = width / aspect;
        } else {
            width = resizeStart.width + dx;
            height = resizeStart.height + dy;
        }
        return typeof clamp === "function" ? clamp(width, height) : { width, height };
    }

    function applySize(size) {
        el.style.setProperty(wVar, `${size.width}px`);
        if (hVar) el.style.setProperty(hVar, `${size.height}px`);
    }

    function moveResize(e) {
        if (!resizing || !resizeStart) return;
        const size = computeSize(e.clientX - resizeStart.x, e.clientY - resizeStart.y);
        applySize(size);
        if (typeof onResize === "function") onResize(size);
        e.preventDefault();
    }

    function endResize(e) {
        if (!resizing) return;
        resizing = false;
        resizeStart = null;
        el.classList.remove("resizing");

        const rect = el.getBoundingClientRect();
        const finalSize = typeof clamp === "function"
            ? clamp(rect.width, rect.height)
            : { width: rect.width, height: rect.height };
        if (typeof save === "function") save(finalSize);
        if (typeof onResize === "function") onResize(finalSize);

        window.removeEventListener("pointermove", moveResize);
        window.removeEventListener("pointerup", endResize);
        window.removeEventListener("pointercancel", endResize);
        window.removeEventListener("blur", endResize);

        try {
            if (e?.pointerId !== undefined && handle.hasPointerCapture(e.pointerId)) {
                handle.releasePointerCapture(e.pointerId);
            }
        } catch {
            /* Embedded webview may drop capture before pointerup */
        }
    }

    handle.addEventListener("pointerdown", (e) => {
        if (typeof disabled === "function" && disabled()) return;

        const rect = el.getBoundingClientRect();
        resizing = true;
        resizeStart = { x: e.clientX, y: e.clientY, width: rect.width, height: rect.height };
        try {
            handle.setPointerCapture(e.pointerId);
        } catch {
            /* Pointer capture is best-effort in the Lively webview */
        }
        el.classList.add("resizing");
        window.addEventListener("pointermove", moveResize);
        window.addEventListener("pointerup", endResize);
        window.addEventListener("pointercancel", endResize);
        window.addEventListener("blur", endResize);
        e.preventDefault();
        e.stopPropagation();
    });
}

/**
 * Wire a lock toggle button that flips a boolean via get()/set(locked) and
 * reflects it on `el` (`.position-locked`) and the button (icon + labels).
 * `onToggle` runs before the state flips (e.g. cancel an in-flight drag).
 */
function makePositionLock({ el, btn, get, set, onToggle }) {
    function updateUi() {
        const locked = !!get();
        if (el) el.classList.toggle("position-locked", locked);
        if (btn) {
            btn.classList.toggle("locked", locked);
            if (typeof Icons !== "undefined") Icons.setLock(btn, locked);
            const label = locked ? "Unlock position" : "Lock position";
            btn.title = label;
            btn.setAttribute("aria-label", label);
        }
    }

    btn?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof onToggle === "function") onToggle();
        set(!get());
        updateUi();
    });

    updateUi();
    return { updateUi };
}

/**
 * Wire a collapse toggle button that flips `.collapsed` on `el`, swaps the
 * plus/minus icon, and persists to `storageKey`. `onChange(collapsed)` runs
 * after each change for gadget-specific side effects.
 */
function makeCollapsible({ el, btn, storageKey, onChange }) {
    function setCollapsedState(collapsed, persist = true) {
        if (el) el.classList.toggle("collapsed", collapsed);
        if (btn && typeof Icons !== "undefined") Icons.setCollapse(btn, collapsed);
        if (typeof onChange === "function") onChange(collapsed);
        if (persist && storageKey) {
            writePersistentStorage(storageKey, collapsed ? "1" : "0");
        }
    }

    btn?.addEventListener("click", () => {
        const collapsed = el ? el.classList.contains("collapsed") : false;
        setCollapsedState(!collapsed);
    });

    return { setCollapsed: setCollapsedState };
}

/**
 * Build a <button> carrying an accessible label/title and a line-md icon.
 * `variant` maps to the shared button class vocabulary; `label` (optional)
 * renders visible text next to the icon.
 */
function createIconButton({ icon, label, title, variant, className, onClick, id }) {
    const btn = document.createElement("button");
    btn.type = "button";
    const classes = ["gadget-btn"];
    if (variant) classes.push(`gadget-btn-${variant}`);
    if (className) classes.push(className);
    btn.className = classes.join(" ");
    if (id) btn.id = id;

    const accessibleLabel = title || label || icon;
    if (accessibleLabel) {
        btn.setAttribute("aria-label", accessibleLabel);
        btn.title = accessibleLabel;
    }

    if (typeof Icons !== "undefined") {
        if (label) {
            Icons.setLabel(btn, icon, label);
        } else {
            Icons.set(btn, icon);
        }
    } else if (label) {
        btn.textContent = label;
    }

    if (typeof onClick === "function") {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            onClick(e);
        });
    }

    return btn;
}

/**
 * Registry tracking each gadget's root element and visibility. Visibility is
 * persisted as a single JSON map under `gadgetVisibility`. Gadgets may supply
 * custom apply/isVisible hooks (e.g. notes, whose display also depends on
 * whether a notes folder is configured).
 */
const Gadgets = (function () {
    const VISIBILITY_KEY = "gadgetVisibility";
    const registry = new Map();
    const launcherButtons = new Map();

    function readVisibilityMap() {
        try {
            const raw = readPersistentStorage(VISIBILITY_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch {
            return null;
        }
    }

    function writeVisibilityMap(map) {
        try {
            writePersistentStorage(VISIBILITY_KEY, JSON.stringify(map));
        } catch {
            /* ignore */
        }
    }

    function resolveEl(gadget) {
        if (!gadget) return null;
        if (typeof gadget.el === "function") return gadget.el();
        if (gadget.el) return gadget.el;
        if (gadget.elId) return document.getElementById(gadget.elId);
        return null;
    }

    function register(config) {
        registry.set(config.id, config);
    }

    function clampGadgetIntoView(gadget) {
        if (!gadget?.bounds) return;
        ensureGadgetOnScreen({
            el: resolveEl(gadget),
            xVar: gadget.bounds.xVar,
            yVar: gadget.bounds.yVar,
            save: gadget.bounds.save
        });
    }

    function scheduleClampIntoView(gadget) {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => clampGadgetIntoView(gadget));
        });
    }

    function bindLauncherButton(id, btn) {
        launcherButtons.set(id, btn);
        updateLauncherButton(id, isVisible(id));
    }

    function updateLauncherButton(id, active) {
        const btn = launcherButtons.get(id);
        if (btn) {
            btn.classList.toggle("active", !!active);
            btn.setAttribute("aria-pressed", active ? "true" : "false");
        }
    }

    function isVisible(id) {
        const gadget = registry.get(id);
        if (!gadget) return false;
        if (typeof gadget.isVisible === "function") return !!gadget.isVisible();
        const el = resolveEl(gadget);
        return !!el && !el.classList.contains("hidden");
    }

    function setVisible(id, visible, persist = true) {
        const gadget = registry.get(id);
        if (!gadget) return;

        if (typeof gadget.apply === "function") {
            gadget.apply(visible);
        } else {
            const el = resolveEl(gadget);
            if (el) el.classList.toggle("hidden", !visible);
        }

        if (visible && typeof gadget.onShow === "function") gadget.onShow();
        if (!visible && typeof gadget.onHide === "function") gadget.onHide();
        if (visible) scheduleClampIntoView(gadget);

        updateLauncherButton(id, visible);

        if (persist) {
            const map = readVisibilityMap() || {};
            map[id] = !!visible;
            writeVisibilityMap(map);
        }
    }

    function toggle(id) {
        setVisible(id, !isVisible(id));
    }

    function applyVisibilityFromState() {
        const saved = readVisibilityMap();
        registry.forEach((gadget, id) => {
            let visible;
            if (saved && Object.prototype.hasOwnProperty.call(saved, id)) {
                visible = !!saved[id];
            } else {
                visible = !!gadget.defaultVisible;
            }
            setVisible(id, visible, false);
        });
    }

    /**
     * Re-read every gadget's persisted layout and visibility. Called when the
     * sync-service delivers state after boot (see reapplyPersistedLayout in
     * persistence.js), so gadgets restore even when the service starts late.
     * Layout runs before visibility so onShow hooks see the final geometry.
     */
    function reloadFromState() {
        registry.forEach((gadget) => {
            if (typeof gadget.reload === "function") gadget.reload();
        });
        applyVisibilityFromState();
    }

    function initViewportGuard() {
        window.addEventListener("resize", () => {
            registry.forEach((gadget, id) => {
                if (isVisible(id)) scheduleClampIntoView(gadget);
            });
        });
    }

    initViewportGuard();

    return {
        register,
        bindLauncherButton,
        isVisible,
        setVisible,
        toggle,
        applyVisibilityFromState,
        reloadFromState
    };
})();

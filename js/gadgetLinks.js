/**
 * Quick-links gadget: a configurable grid of shortcuts. Data persists in
 * `linksData`; position/size in `linksPosition`/`linksSize`. Clicking a link
 * asks the sync-service to open it in the default browser (POST /open-url),
 * falling back to window.open when the service is unavailable.
 */

let linksData = [];

const LINKS_DEFAULT_SIZE = { width: 260, height: 220 };
const LINKS_MIN = { width: 200, height: 140 };

function loadLinksData() {
    try {
        const raw = readPersistentStorage("linksData");
        const parsed = raw ? JSON.parse(raw) : null;
        linksData = Array.isArray(parsed)
            ? parsed.filter((item) => item && item.url).map((item) => ({
                label: String(item.label || item.url),
                url: String(item.url)
            }))
            : [];
    } catch {
        linksData = [];
    }
}

function saveLinksData() {
    writePersistentStorage("linksData", JSON.stringify(linksData));
}

function normalizeUrl(url) {
    const trimmed = String(url || "").trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
}

async function openExternalUrl(url) {
    const target = normalizeUrl(url);
    if (!target) return;

    let opened = false;
    if (typeof syncRequest === "function" && typeof getSyncBaseUrl === "function") {
        try {
            const response = await syncRequest(`${getSyncBaseUrl()}/open-url`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: target }),
                timeoutMs: 5000
            });
            opened = response.ok;
        } catch {
            opened = false;
        }
    }

    if (!opened) {
        try {
            window.open(target, "_blank", "noopener");
        } catch {
            /* nothing else we can do inside the webview */
        }
    }
}

function clampLinksSize(width, height) {
    const maxWidth = Math.max(LINKS_MIN.width, window.innerWidth * 0.6);
    const maxHeight = Math.max(LINKS_MIN.height, window.innerHeight * 0.7);
    return {
        width: Math.round(Math.min(maxWidth, Math.max(LINKS_MIN.width, width))),
        height: Math.round(Math.min(maxHeight, Math.max(LINKS_MIN.height, height)))
    };
}

function renderLinksGrid() {
    const grid = document.getElementById("links-grid");
    if (!grid) return;
    grid.innerHTML = "";

    if (!linksData.length) {
        const empty = document.createElement("p");
        empty.className = "links-empty";
        empty.textContent = "No links yet. Use the pencil to add some.";
        grid.appendChild(empty);
        return;
    }

    linksData.forEach((link) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "links-item";
        btn.title = link.url;
        btn.textContent = link.label || link.url;
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            openExternalUrl(link.url);
        });
        grid.appendChild(btn);
    });
}

function renderLinksEditorList(container) {
    container.innerHTML = "";
    if (!linksData.length) {
        const empty = document.createElement("p");
        empty.className = "app-modal-message";
        empty.textContent = "No links yet.";
        container.appendChild(empty);
        return;
    }

    linksData.forEach((link, index) => {
        const row = document.createElement("div");
        row.className = "links-editor-row";

        const info = document.createElement("span");
        info.className = "links-editor-info";
        info.textContent = `${link.label} — ${link.url}`;

        const removeBtn = createIconButton({
            icon: "trash",
            title: "Remove link",
            className: "gadget-btn-ghost links-editor-remove",
            onClick: () => {
                linksData.splice(index, 1);
                saveLinksData();
                renderLinksEditorList(container);
                renderLinksGrid();
            }
        });

        row.appendChild(info);
        row.appendChild(removeBtn);
        container.appendChild(row);
    });
}

function openLinksEditor() {
    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "event-btn event-btn-primary";
    doneBtn.textContent = "Done";
    doneBtn.addEventListener("click", () => closeAppModal());

    openAppModal({
        title: "Quick links",
        bodyHtml: `
            <div id="links-editor-list" class="links-editor-list"></div>
            <div class="links-editor-add">
                <input id="links-editor-label" class="app-modal-input" type="text" placeholder="Label" autocomplete="off">
                <input id="links-editor-url" class="app-modal-input" type="text" placeholder="https://example.com" autocomplete="off">
                <button id="links-editor-add-btn" type="button" class="event-btn event-btn-secondary">Add</button>
            </div>`,
        footerNodes: [doneBtn],
        onOpen: (host) => {
            const list = host.querySelector("#links-editor-list");
            const labelInput = host.querySelector("#links-editor-label");
            const urlInput = host.querySelector("#links-editor-url");
            const addBtn = host.querySelector("#links-editor-add-btn");
            renderLinksEditorList(list);

            const addLink = () => {
                const url = normalizeUrl(urlInput.value);
                if (!url) {
                    urlInput.focus();
                    return;
                }
                const label = labelInput.value.trim() || url.replace(/^https?:\/\//i, "");
                linksData.push({ label, url });
                saveLinksData();
                labelInput.value = "";
                urlInput.value = "";
                labelInput.focus();
                renderLinksEditorList(list);
                renderLinksGrid();
            };

            addBtn.addEventListener("click", addLink);
            urlInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    addLink();
                }
            });
        }
    });
}

function applyLinksPosition(card) {
    try {
        const raw = readPersistentStorage("linksPosition");
        const pos = raw ? JSON.parse(raw) : null;
        if (pos && typeof pos.xPct === "number") {
            card.style.setProperty("--links-x", `${pos.xPct}%`);
            card.style.setProperty("--links-y", `${pos.yPct}%`);
        }
    } catch {
        /* ignore */
    }
}

function applyLinksSize(card) {
    let size = LINKS_DEFAULT_SIZE;
    try {
        const raw = readPersistentStorage("linksSize");
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed.width === "number") size = parsed;
    } catch {
        /* ignore */
    }
    const clamped = clampLinksSize(size.width, size.height);
    card.style.setProperty("--links-width", `${clamped.width}px`);
    card.style.setProperty("--links-height", `${clamped.height}px`);
}

function buildLinksGadget() {
    const card = document.createElement("div");
    card.id = "links-gadget";
    card.className = "links-gadget gadget hidden";

    const header = document.createElement("div");
    header.className = "gadget-header links-header";

    const title = document.createElement("span");
    title.className = "links-title";
    title.textContent = "Links";

    const actions = document.createElement("div");
    actions.className = "links-header-actions";

    const editBtn = createIconButton({
        icon: "pencil",
        title: "Edit links",
        className: "gadget-btn-ghost",
        onClick: () => openLinksEditor()
    });
    const closeBtn = createIconButton({
        icon: "close-small",
        title: "Hide links",
        className: "gadget-close",
        onClick: () => Gadgets.setVisible("links", false)
    });
    actions.appendChild(editBtn);
    actions.appendChild(closeBtn);

    header.appendChild(title);
    header.appendChild(actions);

    const grid = document.createElement("div");
    grid.id = "links-grid";
    grid.className = "links-grid";

    const handle = document.createElement("div");
    handle.className = "gadget-resize-handle";
    handle.setAttribute("aria-hidden", "true");

    card.appendChild(header);
    card.appendChild(grid);
    card.appendChild(handle);
    document.body.appendChild(card);
    return card;
}

function initLinksGadget() {
    if (document.getElementById("links-gadget")) return;
    loadLinksData();
    const card = buildLinksGadget();
    applyLinksPosition(card);
    applyLinksSize(card);
    renderLinksGrid();

    makeDraggable({
        el: card,
        handle: card.querySelector(".links-header"),
        xVar: "--links-x",
        yVar: "--links-y",
        save: (xPct, yPct) => writePersistentStorage("linksPosition", JSON.stringify({ xPct, yPct, anchor: "topleft" })),
        defaultXPct: 50,
        defaultYPct: 45
    });

    makeResizable({
        el: card,
        handle: card.querySelector(".gadget-resize-handle"),
        wVar: "--links-width",
        hVar: "--links-height",
        clamp: (width, height) => clampLinksSize(width, height),
        save: (size) => writePersistentStorage("linksSize", JSON.stringify(size))
    });

    Gadgets.register({
        id: "links",
        el: card,
        defaultVisible: false
    });
}

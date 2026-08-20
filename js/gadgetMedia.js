/**
 * Now-playing gadget: shows the active Windows media session (art, title,
 * artist, progress) and offers transport controls. Data and commands go
 * through the sync-service `GET /media/now-playing` and `POST /media/control`.
 * Polling only runs while the gadget is visible.
 */

const MEDIA_POLL_MS = 1000;

const mediaState = {
    timer: null,
    duration: null
};

function formatMediaTime(seconds) {
    if (seconds == null || !isFinite(seconds)) return "0:00";
    const total = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
}

function renderNowPlaying(data) {
    const card = document.getElementById("media-gadget");
    if (!card) return;

    const available = !!data?.available;
    card.classList.toggle("media-empty", !available);

    const art = card.querySelector(".media-art");
    const titleEl = card.querySelector(".media-title");
    const artistEl = card.querySelector(".media-artist");
    const fill = card.querySelector(".media-progress-fill");
    const posEl = card.querySelector(".media-time-pos");
    const durEl = card.querySelector(".media-time-dur");
    const playBtn = card.querySelector(".media-playpause");

    if (!available) {
        titleEl.textContent = "Nothing playing";
        artistEl.textContent = "";
        art.style.backgroundImage = "";
        art.classList.add("media-art-empty");
        if (fill) fill.style.width = "0%";
        if (posEl) posEl.textContent = "0:00";
        if (durEl) durEl.textContent = "0:00";
        if (playBtn) Icons.set(playBtn, "play");
        return;
    }

    titleEl.textContent = data.title || "Unknown title";
    artistEl.textContent = data.artist || data.album || "";

    if (data.thumbnail) {
        art.style.backgroundImage = `url("${data.thumbnail}")`;
        art.classList.remove("media-art-empty");
    } else {
        art.style.backgroundImage = "";
        art.classList.add("media-art-empty");
    }

    const duration = data.duration && data.duration > 0 ? data.duration : null;
    const position = data.position || 0;
    mediaState.duration = duration;
    if (fill) {
        const ratio = duration ? Math.min(1, position / duration) : 0;
        fill.style.width = `${ratio * 100}%`;
    }
    if (posEl) posEl.textContent = formatMediaTime(position);
    if (durEl) durEl.textContent = duration ? formatMediaTime(duration) : "--:--";
    if (playBtn) Icons.set(playBtn, data.playing ? "pause" : "play");
}

async function pollMediaOnce() {
    if (typeof syncRequest !== "function" || typeof getSyncBaseUrl !== "function") return;
    try {
        const response = await syncRequest(`${getSyncBaseUrl()}/media/now-playing`, {
            method: "GET",
            timeoutMs: 4000
        });
        if (!response.ok) return;
        renderNowPlaying(await response.json());
    } catch {
        /* transient; keep last state */
    }
}

async function sendMediaControl(action) {
    if (typeof syncRequest !== "function" || typeof getSyncBaseUrl !== "function") return;
    try {
        await syncRequest(`${getSyncBaseUrl()}/media/control`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
            timeoutMs: 4000
        });
    } catch {
        /* ignore */
    }
    // Reflect the new state quickly rather than waiting a full poll cycle.
    window.setTimeout(pollMediaOnce, 150);
}

function startMediaPolling() {
    stopMediaPolling();
    pollMediaOnce();
    mediaState.timer = window.setInterval(pollMediaOnce, MEDIA_POLL_MS);
}

function stopMediaPolling() {
    if (mediaState.timer) {
        window.clearInterval(mediaState.timer);
        mediaState.timer = null;
    }
}

function saveMediaPosition(xPct, yPct) {
    writePersistentStorage("mediaPosition", JSON.stringify({ xPct, yPct, anchor: "topleft" }));
}

function applyMediaLayout(card) {
    try {
        const rawPos = readPersistentStorage("mediaPosition");
        const pos = rawPos ? JSON.parse(rawPos) : null;
        if (pos && typeof pos.xPct === "number") {
            card.style.setProperty("--media-x", `${pos.xPct}%`);
            card.style.setProperty("--media-y", `${pos.yPct}%`);
        }
        const rawSize = readPersistentStorage("mediaSize");
        const size = rawSize ? JSON.parse(rawSize) : null;
        if (size && typeof size.width === "number") {
            card.style.setProperty("--media-width", `${size.width}px`);
        }
    } catch {
        /* ignore */
    }
}

function clampMediaSize(width) {
    return {
        width: Math.round(Math.min(Math.max(240, width), window.innerWidth * 0.6)),
        height: 0
    };
}

function buildMediaGadget() {
    const card = document.createElement("div");
    card.id = "media-gadget";
    card.className = "media-gadget gadget media-empty hidden";

    const header = document.createElement("div");
    header.className = "gadget-header media-header";

    const title = document.createElement("span");
    title.className = "media-heading";
    title.textContent = "Now playing";

    const closeBtn = createIconButton({
        icon: "close-small",
        title: "Hide player",
        className: "gadget-close",
        onClick: () => Gadgets.setVisible("media", false)
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "media-body";

    const art = document.createElement("div");
    art.className = "media-art media-art-empty";

    const info = document.createElement("div");
    info.className = "media-info";
    const trackTitle = document.createElement("div");
    trackTitle.className = "media-title";
    trackTitle.textContent = "Nothing playing";
    const trackArtist = document.createElement("div");
    trackArtist.className = "media-artist";
    info.appendChild(trackTitle);
    info.appendChild(trackArtist);

    body.appendChild(art);
    body.appendChild(info);

    const progress = document.createElement("div");
    progress.className = "media-progress";
    const fill = document.createElement("div");
    fill.className = "media-progress-fill";
    progress.appendChild(fill);

    const times = document.createElement("div");
    times.className = "media-times";
    const posEl = document.createElement("span");
    posEl.className = "media-time-pos";
    posEl.textContent = "0:00";
    const durEl = document.createElement("span");
    durEl.className = "media-time-dur";
    durEl.textContent = "0:00";
    times.appendChild(posEl);
    times.appendChild(durEl);

    const controls = document.createElement("div");
    controls.className = "media-controls";
    const prevBtn = createIconButton({
        icon: "chevron-left",
        title: "Previous",
        className: "gadget-btn-ghost media-prev",
        onClick: () => sendMediaControl("previous")
    });
    const playBtn = createIconButton({
        icon: "play",
        title: "Play / pause",
        className: "media-playpause",
        onClick: () => sendMediaControl("play_pause")
    });
    const nextBtn = createIconButton({
        icon: "chevron-right",
        title: "Next",
        className: "gadget-btn-ghost media-next",
        onClick: () => sendMediaControl("next")
    });
    controls.appendChild(prevBtn);
    controls.appendChild(playBtn);
    controls.appendChild(nextBtn);

    const handle = document.createElement("div");
    handle.className = "gadget-resize-handle";
    handle.setAttribute("aria-hidden", "true");

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(progress);
    card.appendChild(times);
    card.appendChild(controls);
    card.appendChild(handle);
    document.body.appendChild(card);
    return card;
}

function initMediaGadget() {
    if (document.getElementById("media-gadget")) return;
    const card = buildMediaGadget();
    applyMediaLayout(card);

    makeDraggable({
        el: card,
        handle: card.querySelector(".media-header"),
        xVar: "--media-x",
        yVar: "--media-y",
        save: saveMediaPosition,
        defaultXPct: 55,
        defaultYPct: 60
    });

    makeResizable({
        el: card,
        handle: card.querySelector(".gadget-resize-handle"),
        wVar: "--media-width",
        clamp: (width) => clampMediaSize(width),
        save: (size) => writePersistentStorage("mediaSize", JSON.stringify({ width: size.width }))
    });

    Gadgets.register({
        id: "media",
        el: card,
        defaultVisible: false,
        bounds: { xVar: "--media-x", yVar: "--media-y", save: saveMediaPosition },
        onShow: () => startMediaPolling(),
        onHide: () => stopMediaPolling(),
        reload: () => applyMediaLayout(card)
    });
}

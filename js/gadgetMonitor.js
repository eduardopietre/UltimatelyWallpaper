/**
 * System monitor gadget: live CPU / RAM / GPU usage with Task-Manager-style
 * rolling area charts. Data comes from the sync-service `GET /system/metrics`
 * endpoint; polling only runs while the gadget is visible. GPU is shown only
 * when the service reports an available adapter (nvidia-smi).
 */

const MONITOR_MAX_POINTS = 60;
const MONITOR_POLL_MS = 1500;

const monitorState = {
    timer: null,
    history: { cpu: [], ram: [], gpu: [] },
    gpuAvailable: false
};

const MONITOR_METRICS = [
    { key: "cpu", label: "CPU", color: "var(--accent-color, #3a588e)" },
    { key: "ram", label: "RAM", color: "#3aa06a" },
    { key: "gpu", label: "GPU", color: "#e0873a" }
];

function pushMonitorSample(key, value) {
    const series = monitorState.history[key];
    series.push(value);
    if (series.length > MONITOR_MAX_POINTS) series.shift();
}

function drawMonitorChart(canvas, series, color) {
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Background grid, evoking the Windows Task Manager look.
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
        const y = (height / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    if (series.length < 2) return;

    const stepX = width / (MONITOR_MAX_POINTS - 1);
    const startIndex = MONITOR_MAX_POINTS - series.length;
    const pointX = (i) => (startIndex + i) * stepX;
    const pointY = (v) => height - (Math.max(0, Math.min(100, v)) / 100) * height;

    ctx.beginPath();
    ctx.moveTo(pointX(0), pointY(series[0]));
    for (let i = 1; i < series.length; i += 1) {
        ctx.lineTo(pointX(i), pointY(series[i]));
    }

    const resolvedColor = color.startsWith("var(")
        ? (getComputedStyle(document.documentElement).getPropertyValue("--accent-color").trim() || "#3a588e")
        : color;

    // Filled area under the line.
    ctx.lineTo(pointX(series.length - 1), height);
    ctx.lineTo(pointX(0), height);
    ctx.closePath();
    ctx.fillStyle = hexWithAlpha(resolvedColor, 0.22);
    ctx.fill();

    // Line on top.
    ctx.beginPath();
    ctx.moveTo(pointX(0), pointY(series[0]));
    for (let i = 1; i < series.length; i += 1) {
        ctx.lineTo(pointX(i), pointY(series[i]));
    }
    ctx.strokeStyle = resolvedColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
}

function hexWithAlpha(color, alpha) {
    const hex = color.trim().replace("#", "");
    if (hex.length !== 6) return color;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function redrawMonitorCharts() {
    MONITOR_METRICS.forEach((metric) => {
        const canvas = document.querySelector(`#monitor-gadget .monitor-metric[data-metric="${metric.key}"] .monitor-chart`);
        drawMonitorChart(canvas, monitorState.history[metric.key], metric.color);
    });
}

function setMonitorMetric(key, percent, valueText) {
    const metricEl = document.querySelector(`#monitor-gadget .monitor-metric[data-metric="${key}"]`);
    if (!metricEl) return;
    const valueEl = metricEl.querySelector(".monitor-metric-value");
    if (valueEl) valueEl.textContent = valueText;
}

function applyMonitorMetrics(data) {
    const cpuPercent = data?.cpu?.percent ?? 0;
    pushMonitorSample("cpu", cpuPercent);
    const cores = data?.cpu?.cores ? ` · ${data.cpu.cores} cores` : "";
    setMonitorMetric("cpu", cpuPercent, `${Math.round(cpuPercent)}%${cores}`);

    const ramPercent = data?.memory?.percent ?? 0;
    pushMonitorSample("ram", ramPercent);
    const usedGb = data?.memory?.usedGb;
    const totalGb = data?.memory?.totalGb;
    const ramDetail = usedGb != null && totalGb != null ? ` · ${usedGb}/${totalGb} GB` : "";
    setMonitorMetric("ram", ramPercent, `${Math.round(ramPercent)}%${ramDetail}`);

    const gpu = data?.gpu;
    const gpuMetricEl = document.querySelector('#monitor-gadget .monitor-metric[data-metric="gpu"]');
    if (gpu?.available) {
        monitorState.gpuAvailable = true;
        if (gpuMetricEl) gpuMetricEl.classList.remove("hidden");
        pushMonitorSample("gpu", gpu.percent ?? 0);
        setMonitorMetric("gpu", gpu.percent ?? 0, `${Math.round(gpu.percent ?? 0)}% · ${gpu.memPercent ?? 0}% vram`);
        const labelEl = gpuMetricEl?.querySelector(".monitor-metric-sub");
        if (labelEl && gpu.name) labelEl.textContent = gpu.name;
    } else if (gpuMetricEl) {
        monitorState.gpuAvailable = false;
        gpuMetricEl.classList.add("hidden");
    }

    redrawMonitorCharts();
}

async function pollMonitorOnce() {
    if (typeof syncRequest !== "function" || typeof getSyncBaseUrl !== "function") return;
    try {
        const response = await syncRequest(`${getSyncBaseUrl()}/system/metrics`, {
            method: "GET",
            timeoutMs: 4000
        });
        if (!response.ok) return;
        const data = await response.json();
        applyMonitorMetrics(data);
    } catch {
        /* transient; the next tick will retry */
    }
}

function startMonitorPolling() {
    stopMonitorPolling();
    pollMonitorOnce();
    monitorState.timer = window.setInterval(pollMonitorOnce, MONITOR_POLL_MS);
}

function stopMonitorPolling() {
    if (monitorState.timer) {
        window.clearInterval(monitorState.timer);
        monitorState.timer = null;
    }
}

function buildMonitorMetricRow(metric) {
    const row = document.createElement("div");
    row.className = "monitor-metric";
    row.dataset.metric = metric.key;
    if (metric.key === "gpu") row.classList.add("hidden");

    const head = document.createElement("div");
    head.className = "monitor-metric-head";

    const label = document.createElement("span");
    label.className = "monitor-metric-label";
    label.style.color = metric.color;
    label.textContent = metric.label;

    const value = document.createElement("span");
    value.className = "monitor-metric-value";
    value.textContent = "--%";

    head.appendChild(label);
    head.appendChild(value);

    const sub = document.createElement("span");
    sub.className = "monitor-metric-sub";

    const canvas = document.createElement("canvas");
    canvas.className = "monitor-chart";

    row.appendChild(head);
    if (metric.key === "gpu") row.appendChild(sub);
    row.appendChild(canvas);
    return row;
}

function applyMonitorLayout(card) {
    try {
        const rawPos = readPersistentStorage("monitorPosition");
        const pos = rawPos ? JSON.parse(rawPos) : null;
        if (pos && typeof pos.xPct === "number") {
            card.style.setProperty("--monitor-x", `${pos.xPct}%`);
            card.style.setProperty("--monitor-y", `${pos.yPct}%`);
        }
        const rawSize = readPersistentStorage("monitorSize");
        const size = rawSize ? JSON.parse(rawSize) : null;
        if (size && typeof size.width === "number") {
            card.style.setProperty("--monitor-width", `${size.width}px`);
            card.style.setProperty("--monitor-height", `${size.height}px`);
        }
    } catch {
        /* ignore */
    }
}

function clampMonitorSize(width, height) {
    return {
        width: Math.round(Math.min(Math.max(240, width), window.innerWidth * 0.7)),
        height: Math.round(Math.min(Math.max(240, height), window.innerHeight * 0.85))
    };
}

function buildMonitorGadget() {
    const card = document.createElement("div");
    card.id = "monitor-gadget";
    card.className = "monitor-gadget gadget hidden";

    const header = document.createElement("div");
    header.className = "gadget-header monitor-header";

    const title = document.createElement("span");
    title.className = "monitor-title";
    title.textContent = "System";

    const closeBtn = createIconButton({
        icon: "close-small",
        title: "Hide monitor",
        className: "gadget-close",
        onClick: () => Gadgets.setVisible("monitor", false)
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "monitor-body";
    MONITOR_METRICS.forEach((metric) => body.appendChild(buildMonitorMetricRow(metric)));

    const handle = document.createElement("div");
    handle.className = "gadget-resize-handle";
    handle.setAttribute("aria-hidden", "true");

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(handle);
    document.body.appendChild(card);
    return card;
}

function initMonitorGadget() {
    if (document.getElementById("monitor-gadget")) return;
    const card = buildMonitorGadget();
    applyMonitorLayout(card);

    makeDraggable({
        el: card,
        handle: card.querySelector(".monitor-header"),
        xVar: "--monitor-x",
        yVar: "--monitor-y",
        save: (xPct, yPct) => writePersistentStorage("monitorPosition", JSON.stringify({ xPct, yPct, anchor: "topleft" })),
        defaultXPct: 55,
        defaultYPct: 20
    });

    makeResizable({
        el: card,
        handle: card.querySelector(".gadget-resize-handle"),
        wVar: "--monitor-width",
        hVar: "--monitor-height",
        clamp: (width, height) => clampMonitorSize(width, height),
        save: (size) => writePersistentStorage("monitorSize", JSON.stringify(size)),
        onResize: () => redrawMonitorCharts()
    });

    Gadgets.register({
        id: "monitor",
        el: card,
        defaultVisible: false,
        onShow: () => startMonitorPolling(),
        onHide: () => stopMonitorPolling()
    });
}

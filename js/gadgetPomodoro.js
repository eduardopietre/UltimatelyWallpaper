/**
 * Pomodoro gadget: a local focus/break timer. Durations persist in
 * `pomodoroPrefs`; position in `pomodoroPosition`. The running countdown is
 * ephemeral (not persisted) — it resets when the wallpaper reloads.
 */

let pomodoroPrefs = { focusMin: 25, breakMin: 5 };
let pomodoroRuntime = {
    phase: "focus",
    remaining: 25 * 60,
    running: false,
    timer: null
};

const POMODORO_MIN_MINUTES = 1;
const POMODORO_MAX_MINUTES = 90;

function loadPomodoroPrefs() {
    try {
        const raw = readPersistentStorage("pomodoroPrefs");
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed.focusMin === "number" && typeof parsed.breakMin === "number") {
            pomodoroPrefs = {
                focusMin: clampPomodoroMinutes(parsed.focusMin),
                breakMin: clampPomodoroMinutes(parsed.breakMin)
            };
        }
    } catch {
        /* keep defaults */
    }
}

function savePomodoroPrefs() {
    writePersistentStorage("pomodoroPrefs", JSON.stringify(pomodoroPrefs));
}

function clampPomodoroMinutes(value) {
    return Math.min(POMODORO_MAX_MINUTES, Math.max(POMODORO_MIN_MINUTES, Math.round(value)));
}

function pomodoroPhaseMinutes(phase) {
    return phase === "break" ? pomodoroPrefs.breakMin : pomodoroPrefs.focusMin;
}

function formatPomodoroTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderPomodoro() {
    const card = document.getElementById("pomodoro-gadget");
    if (!card) return;

    card.classList.toggle("phase-focus", pomodoroRuntime.phase === "focus");
    card.classList.toggle("phase-break", pomodoroRuntime.phase === "break");

    const timeEl = card.querySelector(".pomodoro-time");
    if (timeEl) timeEl.textContent = formatPomodoroTime(pomodoroRuntime.remaining);

    const phaseEl = card.querySelector(".pomodoro-phase");
    if (phaseEl) phaseEl.textContent = pomodoroRuntime.phase === "break" ? "Break" : "Focus";

    const startBtn = card.querySelector(".pomodoro-start");
    if (startBtn) {
        Icons.set(startBtn, pomodoroRuntime.running ? "pause" : "play");
        const label = pomodoroRuntime.running ? "Pause" : "Start";
        startBtn.title = label;
        startBtn.setAttribute("aria-label", label);
    }

    const focusValue = card.querySelector(".pomodoro-focus-value");
    if (focusValue) focusValue.textContent = `${pomodoroPrefs.focusMin}m`;
    const breakValue = card.querySelector(".pomodoro-break-value");
    if (breakValue) breakValue.textContent = `${pomodoroPrefs.breakMin}m`;
}

function stopPomodoroTimer() {
    if (pomodoroRuntime.timer) {
        window.clearInterval(pomodoroRuntime.timer);
        pomodoroRuntime.timer = null;
    }
}

function pomodoroTick() {
    if (pomodoroRuntime.remaining > 0) {
        pomodoroRuntime.remaining -= 1;
        renderPomodoro();
        return;
    }
    // Phase complete: switch focus <-> break and keep running.
    pomodoroRuntime.phase = pomodoroRuntime.phase === "focus" ? "break" : "focus";
    pomodoroRuntime.remaining = pomodoroPhaseMinutes(pomodoroRuntime.phase) * 60;
    const card = document.getElementById("pomodoro-gadget");
    if (card) {
        card.classList.remove("pomodoro-flash");
        // Force reflow so the animation can retrigger.
        void card.offsetWidth;
        card.classList.add("pomodoro-flash");
    }
    renderPomodoro();
}

function startPomodoro() {
    if (pomodoroRuntime.running) return;
    pomodoroRuntime.running = true;
    stopPomodoroTimer();
    pomodoroRuntime.timer = window.setInterval(pomodoroTick, 1000);
    renderPomodoro();
}

function pausePomodoro() {
    pomodoroRuntime.running = false;
    stopPomodoroTimer();
    renderPomodoro();
}

function togglePomodoro() {
    if (pomodoroRuntime.running) {
        pausePomodoro();
    } else {
        startPomodoro();
    }
}

function resetPomodoro() {
    pausePomodoro();
    pomodoroRuntime.phase = "focus";
    pomodoroRuntime.remaining = pomodoroPhaseMinutes("focus") * 60;
    renderPomodoro();
}

function adjustPomodoroDuration(phase, delta) {
    const key = phase === "break" ? "breakMin" : "focusMin";
    pomodoroPrefs[key] = clampPomodoroMinutes(pomodoroPrefs[key] + delta);
    savePomodoroPrefs();
    // Reflect the new duration immediately when idle on that phase.
    if (!pomodoroRuntime.running && pomodoroRuntime.phase === phase) {
        pomodoroRuntime.remaining = pomodoroPhaseMinutes(phase) * 60;
    }
    renderPomodoro();
}

function buildPomodoroStepper(labelText, phase, valueClass) {
    const row = document.createElement("div");
    row.className = "pomodoro-stepper";

    const label = document.createElement("span");
    label.className = "pomodoro-stepper-label";
    label.textContent = labelText;

    const minus = createIconButton({
        icon: "minus",
        title: `Decrease ${labelText.toLowerCase()}`,
        className: "gadget-btn-ghost pomodoro-step-btn",
        onClick: () => adjustPomodoroDuration(phase, -1)
    });

    const value = document.createElement("span");
    value.className = `pomodoro-value ${valueClass}`;

    const plus = createIconButton({
        icon: "plus",
        title: `Increase ${labelText.toLowerCase()}`,
        className: "gadget-btn-ghost pomodoro-step-btn",
        onClick: () => adjustPomodoroDuration(phase, 1)
    });

    row.appendChild(label);
    row.appendChild(minus);
    row.appendChild(value);
    row.appendChild(plus);
    return row;
}

function buildPomodoroGadget() {
    const card = document.createElement("div");
    card.id = "pomodoro-gadget";
    card.className = "pomodoro-gadget gadget hidden phase-focus";

    const header = document.createElement("div");
    header.className = "gadget-header pomodoro-header";

    const phase = document.createElement("span");
    phase.className = "pomodoro-phase";
    phase.textContent = "Focus";

    const closeBtn = createIconButton({
        icon: "close-small",
        title: "Hide pomodoro",
        className: "gadget-close",
        onClick: () => Gadgets.setVisible("pomodoro", false)
    });

    header.appendChild(phase);
    header.appendChild(closeBtn);

    const time = document.createElement("div");
    time.className = "pomodoro-time";
    time.textContent = "25:00";

    const controls = document.createElement("div");
    controls.className = "pomodoro-controls";

    const startBtn = createIconButton({
        icon: "play",
        title: "Start",
        className: "pomodoro-start",
        onClick: () => togglePomodoro()
    });
    const resetBtn = createIconButton({
        icon: "rotate-180",
        title: "Reset",
        className: "gadget-btn-ghost pomodoro-reset",
        onClick: () => resetPomodoro()
    });
    controls.appendChild(startBtn);
    controls.appendChild(resetBtn);

    const steppers = document.createElement("div");
    steppers.className = "pomodoro-steppers";
    steppers.appendChild(buildPomodoroStepper("Focus", "focus", "pomodoro-focus-value"));
    steppers.appendChild(buildPomodoroStepper("Break", "break", "pomodoro-break-value"));

    card.appendChild(header);
    card.appendChild(time);
    card.appendChild(controls);
    card.appendChild(steppers);
    document.body.appendChild(card);
    return card;
}

function applyPomodoroPosition(card) {
    try {
        const raw = readPersistentStorage("pomodoroPosition");
        const pos = raw ? JSON.parse(raw) : null;
        if (pos && typeof pos.xPct === "number") {
            card.style.setProperty("--pomodoro-x", `${pos.xPct}%`);
            card.style.setProperty("--pomodoro-y", `${pos.yPct}%`);
        }
    } catch {
        /* ignore */
    }
}

function initPomodoroGadget() {
    if (document.getElementById("pomodoro-gadget")) return;
    loadPomodoroPrefs();
    pomodoroRuntime.remaining = pomodoroPhaseMinutes("focus") * 60;

    const card = buildPomodoroGadget();
    applyPomodoroPosition(card);

    makeDraggable({
        el: card,
        handle: card,
        xVar: "--pomodoro-x",
        yVar: "--pomodoro-y",
        save: (xPct, yPct) => writePersistentStorage("pomodoroPosition", JSON.stringify({ xPct, yPct, anchor: "topleft" })),
        defaultXPct: 45,
        defaultYPct: 30
    });

    Gadgets.register({
        id: "pomodoro",
        el: card,
        defaultVisible: false
    });

    renderPomodoro();
}

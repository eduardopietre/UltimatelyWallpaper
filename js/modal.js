let modalHostBuilt = false;

function ensureModalHost() {
    if (modalHostBuilt) return document.getElementById("app-modal-host");
    const host = document.createElement("div");
    host.id = "app-modal-host";
    host.className = "app-modal-host hidden";
    host.setAttribute("aria-hidden", "true");
    host.innerHTML = `
        <div class="app-modal-backdrop" data-modal-dismiss="true"></div>
        <div class="app-modal" role="dialog" aria-modal="true">
            <div class="app-modal-header">
                <h2 id="app-modal-title" class="app-modal-title"></h2>
                <button type="button" class="app-modal-close" data-modal-dismiss="true" aria-label="Close">${Icons.svg("close-small")}</button>
            </div>
            <div id="app-modal-body" class="app-modal-body"></div>
            <div id="app-modal-footer" class="app-modal-footer"></div>
        </div>`;
    document.body.appendChild(host);
    modalHostBuilt = true;
    return host;
}

function closeAppModal() {
    const host = document.getElementById("app-modal-host");
    if (!host) return;
    host.classList.add("hidden");
    host.setAttribute("aria-hidden", "true");
    host.querySelector("#app-modal-body").innerHTML = "";
    host.querySelector("#app-modal-footer").innerHTML = "";
}

function openAppModal({ title, bodyHtml, footerNodes, onOpen }) {
    const host = ensureModalHost();
    host.querySelector("#app-modal-title").textContent = title || "";
    host.querySelector("#app-modal-body").innerHTML = bodyHtml || "";

    const footer = host.querySelector("#app-modal-footer");
    footer.innerHTML = "";
    for (const node of footerNodes || []) {
        footer.appendChild(node);
    }

    host.classList.remove("hidden");
    host.setAttribute("aria-hidden", "false");

    host.querySelectorAll("[data-modal-dismiss]").forEach((el) => {
        el.onclick = () => closeAppModal();
    });

    if (typeof onOpen === "function") onOpen(host);
}

function showTextPrompt({ title, prompt, initialValue = "" }) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            closeAppModal();
            resolve(value);
        };

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "event-btn event-btn-secondary";
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", () => finish(null));

        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "event-btn event-btn-primary";
        saveBtn.textContent = "Save";

        openAppModal({
            title,
            bodyHtml: `
                <p class="app-modal-message">${escapeHtml(prompt || "")}</p>
                <input id="app-modal-input" class="app-modal-input" type="text" autocomplete="off">`,
            footerNodes: [cancelBtn, saveBtn],
            onOpen: (host) => {
                const input = host.querySelector("#app-modal-input");
                if (!input) {
                    finish(null);
                    return;
                }
                input.value = initialValue || "";
                input.focus();
                input.select();

                const submit = () => {
                    const value = input.value.trim();
                    finish(value || null);
                };

                saveBtn.addEventListener("click", submit);
                input.addEventListener("keydown", (event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        submit();
                    }
                    if (event.key === "Escape") {
                        event.preventDefault();
                        finish(null);
                    }
                });
            }
        });
    });
}

function showConfirm({ title, message, confirmLabel = "Delete", cancelLabel = "Cancel", danger = true }) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            closeAppModal();
            resolve(value);
        };

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "event-btn event-btn-secondary";
        cancelBtn.textContent = cancelLabel;
        cancelBtn.addEventListener("click", () => finish(false));

        const confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = danger ? "event-btn event-btn-danger" : "event-btn event-btn-primary";
        confirmBtn.textContent = confirmLabel;
        confirmBtn.addEventListener("click", () => finish(true));

        openAppModal({
            title,
            bodyHtml: `<p class="app-modal-message">${escapeHtml(message || "")}</p>`,
            footerNodes: [cancelBtn, confirmBtn]
        });
    });
}

function showRecurringDeleteChoice({ title, eventTitle }) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            closeAppModal();
            resolve(value);
        };

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "event-btn event-btn-secondary";
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", () => finish(null));

        const thisBtn = document.createElement("button");
        thisBtn.type = "button";
        thisBtn.className = "event-btn event-btn-secondary";
        thisBtn.textContent = "This occurrence";
        thisBtn.addEventListener("click", () => finish("this"));

        const allBtn = document.createElement("button");
        allBtn.type = "button";
        allBtn.className = "event-btn event-btn-danger";
        allBtn.textContent = "Entire series";
        allBtn.addEventListener("click", () => finish("all"));

        const label = eventTitle ? `"${eventTitle}"` : "this recurring event";
        openAppModal({
            title,
            bodyHtml: `<p class="app-modal-message">Delete ${escapeHtml(label)}?</p>`,
            footerNodes: [cancelBtn, thisBtn, allBtn]
        });
    });
}

function showAlert({ title, message }) {
    return new Promise((resolve) => {
        const okBtn = document.createElement("button");
        okBtn.type = "button";
        okBtn.className = "event-btn event-btn-primary";
        okBtn.textContent = "OK";
        okBtn.addEventListener("click", () => {
            closeAppModal();
            resolve();
        });

        openAppModal({
            title,
            bodyHtml: `<p class="app-modal-message">${escapeHtml(message || "")}</p>`,
            footerNodes: [okBtn]
        });
    });
}

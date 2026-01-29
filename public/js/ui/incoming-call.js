// Incoming Call Modal (UI-only module)
// Hotkeys: Ctrl+Shift+I (open), Ctrl+Shift+O (force close), Esc (decline)
// Reads callQueue from config.json (array of numbers as strings, e.g. ["517","883"])
// Fetches dossier HTML to extract dossierData JSON (needs "Ответственный" inside).

import { el, fetchText } from "./util.js";

const LAWYERS = [
  "Котова Людмила",
  "Титов Степан",
  "Поздняков Александр",
  "Бурлов Евгений",
  "Сафонова Ирина",
  "Арутюнов Вагит",
  "Николаев Леонид",
  "Смирнов Геннадий"
];

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function digitsToId(numStr) {
  const n = String(numStr || "").trim();
  const m = n.match(/^(\d{3})$/);
  if (!m) return null;
  return `c${m[1]}`;
}

function idToDigits(id) {
  const m = String(id || "").match(/^c(\d{3})$/i);
  return m ? m[1] : "";
}

function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }

// Extract dossierData from HTML produced by our generator:
// <script type="application/json" id="dossierData">{...}</script>
function extractDossierData(htmlText) {
  if (!htmlText) return null;
  const re = /<script[^>]*\bid=["']dossierData["'][^>]*\btype=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i;
  const m = htmlText.match(re);
  if (!m) {
    // allow swapped attribute order
    const re2 = /<script[^>]*\btype=["']application\/json["'][^>]*\bid=["']dossierData["'][^>]*>([\s\S]*?)<\/script>/i;
    const m2 = htmlText.match(re2);
    if (!m2) return null;
    return safeJsonParse(m2[1].trim());
  }
  return safeJsonParse(m[1].trim());
}

function pickRandomClient(clients) {
  if (!clients || !clients.length) return null;
  const idx = Math.floor(Math.random() * clients.length);
  return clients[idx];
}

async function loadResponsibleFromDossier(client) {
  const url = client?.dossier;
  if (!url) return "";
  try {
    const html = await fetchText(url);
    const data = extractDossierData(html);
    return data?.dossier?.responsible || "";
  } catch {
    return "";
  }
}

function setStatusRing(config, elStatus, statusName) {
  elStatus.textContent = statusName || "—";
  const map = config?.statusColors || {};
  const color = map[statusName] || "var(--status-closed)";
  elStatus.style.borderColor = color;
  elStatus.style.color = color;
}

function ensureIcon(spanEl, kind) {
  // kind: "accept" or "decline"
  const pngSrc = kind === "accept" ? "assets/ui/accept.png" : "assets/ui/decline.png";

  // Try png first; if it fails, fall back to inline svg.
  const img = document.createElement("img");
  img.alt = "";
  img.src = pngSrc;
  img.onload = () => {
    spanEl.innerHTML = "";
    spanEl.appendChild(img);
  };
  img.onerror = () => {
    spanEl.innerHTML = "";
    spanEl.appendChild(svgIcon(kind));
  };
}

function svgIcon(kind) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "white");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  // Simple phone icons
  const p = document.createElementNS(ns, "path");
  if (kind === "accept") {
    p.setAttribute("d", "M22 16.92v3a2 2 0 0 1-2.18 2A19.8 19.8 0 0 1 3 5.18 2 2 0 0 1 5.11 3h3a2 2 0 0 1 2 1.72c.12.86.3 1.7.54 2.5a2 2 0 0 1-.45 2.11L9.1 10.9a16 16 0 0 0 4 4l1.57-1.1a2 2 0 0 1 2.11-.45c.8.24 1.64.42 2.5.54A2 2 0 0 1 22 16.92z");
  } else {
    // decline: same phone + slash
    p.setAttribute("d", "M22 16.92v3a2 2 0 0 1-2.18 2A19.8 19.8 0 0 1 3 5.18 2 2 0 0 1 5.11 3h3a2 2 0 0 1 2 1.72c.12.86.3 1.7.54 2.5a2 2 0 0 1-.45 2.11L9.1 10.9a16 16 0 0 0 4 4l1.57-1.1a2 2 0 0 1 2.11-.45c.8.24 1.64.42 2.5.54A2 2 0 0 1 22 16.92z");
    const slash = document.createElementNS(ns, "path");
    slash.setAttribute("d", "M3 3l18 18");
    svg.appendChild(slash);
  }
  svg.appendChild(p);
  return svg;
}

export function initIncomingCallModal({
  config,
  getClients,
  onAcceptClient,   // async (clientId) => void
}) {
  const overlay = el("callOverlay");
  const nameEl = el("callClientName");
  const statusEl = el("callClientStatus");
  const respEl = el("callResponsible");
  const numEl = el("callClientNumber");
  const photoEl = el("callClientPhoto");
  const acceptBtn = el("callAcceptBtn");
  const declineBtn = el("callDeclineBtn");
  const transferToggle = el("callTransferToggle");
  const transferPanel = el("callTransferPanel");
  const lawyerSelect = el("callLawyerSelect");
  const toast = el("callToast");

  // icons
  ensureIcon(overlay.querySelector('[data-icon="accept"]'), "accept");
  ensureIcon(overlay.querySelector('[data-icon="decline"]'), "decline");

  // state
  let isOpen = false;
  let currentClient = null;

  const queue = Array.isArray(config?.callQueue) ? config.callQueue : [];
  const storageKey = "lawui:callQueueIndex";

  function getNextFromQueue(clients) {
    if (!queue.length) return pickRandomClient(clients);

    let idx = Number(localStorage.getItem(storageKey) || "0");
    if (!Number.isFinite(idx)) idx = 0;

    const entry = queue[idx % queue.length];
    // advance pointer (cyclic)
    localStorage.setItem(storageKey, String((idx + 1) % queue.length));

    const cid = digitsToId(entry);
    const found = clients.find(c => c.id === cid);
    return found || pickRandomClient(clients);
  }

  function open() {
    if (isOpen) return;
    const clients = getClients() || [];
    currentClient = getNextFromQueue(clients);
    if (!currentClient) return;

    // Fill UI (base data)
    nameEl.textContent = [currentClient.lastName, currentClient.firstName].filter(Boolean).join(" ").trim() || "—";
    numEl.textContent = idToDigits(currentClient.id) || "—";
    photoEl.src = currentClient.photo || "assets/clients/photos/placeholder.svg";
    setStatusRing(config, statusEl, currentClient.status);

    // Responsible (from dossier)
    respEl.textContent = "…";
    loadResponsibleFromDossier(currentClient).then(resp => {
      const r = resp || "—";
      respEl.textContent = r;

      // lawyer select default to current responsible
      lawyerSelect.innerHTML = LAWYERS.map(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        if (name === resp) opt.selected = true;
        return opt;
      }).map(opt => opt.outerHTML).join("");

      // If responsible not in list, prepend it (rare)
      if (resp && !LAWYERS.includes(resp)) {
        lawyerSelect.insertAdjacentHTML("afterbegin", `<option value="${escapeHtml(resp)}" selected>${escapeHtml(resp)}</option>`);
      }
    });

    // reset transfer UI
    transferPanel.classList.add("is-hidden");
    toast.classList.add("is-hidden");
    toast.textContent = "Переведено";
    transferToggle.disabled = false;

    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    isOpen = true;

    // focus
    declineBtn.focus();
  }

  function close() {
    if (!isOpen) return;
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    isOpen = false;
    currentClient = null;
  }

  async function accept() {
    if (!currentClient) return close();
    const cid = currentClient.id;
    close();
    await onAcceptClient?.(cid);
  }

  function decline() {
    close();
  }

  function showToast(text) {
    toast.textContent = text;
    toast.classList.remove("is-hidden");
    transferToggle.disabled = true;
    setTimeout(() => {
      // auto close after ~4.5s
      close();
    }, 4500);
  }

  transferToggle.addEventListener("click", () => {
    transferPanel.classList.toggle("is-hidden");
  });

  lawyerSelect.addEventListener("change", () => {
    const name = lawyerSelect.value;
    if (!name) return;
    // show transfer toast and close
    showToast(`Переведено на: ${name}`);
  });

  acceptBtn.addEventListener("click", accept);
  declineBtn.addEventListener("click", decline);

  // click outside closes (decline)
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) decline();
  });

  // hotkeys
window.addEventListener("keydown", (e) => {
  // Ctrl (или Cmd на mac)
  const ctrl = e.ctrlKey || e.metaKey;

  // Если хочешь: не ловить хоткеи во время набора текста
  const t = e.target;
  const typing =
    t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  if (typing) return;

  if (!ctrl) return;

  if (e.code === "ArrowLeft") {
    e.preventDefault();
    open();
  }

  if (e.code === "ArrowRight") {
    e.preventDefault();
    close();
  }

  if (isOpen && e.key === "Escape") {
    e.preventDefault();
    close();
  }
}, { capture: true });

  // html escape for rare injected values
  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  return { open, close };
}

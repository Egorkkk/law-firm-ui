import { loadConfig } from "./config-loader.js";
import { loadClients, getClients, getCurrentClient, nextClient, prevClient, setCurrentById } from "./data-store.js";
import { initSplitters } from "./splitters.js";
import { createWaveformPlayer } from "./waveform.js";
import { attachRichEditor } from "./editor.js";
import { initTabs } from "./ui/tabs.js";
import { el, qsa, fetchText } from "./ui/util.js";
import { initClientsAdmin } from "./ui/clients-admin.js";
import { initIncomingCallModal } from "./ui/incoming-call.js";

const state = {
  config: null,
  waveform: null,
  editor: null,
  tabs: null,
  admin: null,
  callModal: null
};

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("lawui:theme", theme);
}

function getThemeFallback(config) {
  return localStorage.getItem("lawui:theme") || config?.app?.defaultTheme || "light";
}

function routeTo(name) {
  location.hash = `#/${name}`;
}

function getRoute() {
  const m = (location.hash || "").match(/^#\/([a-z-]+)/i);
  return m ? m[1] : null;
}

function setActiveScreen(name) {
  qsa(".screen").forEach(s => s.classList.toggle("is-active", s.dataset.screen === name));
  qsa(".nav__btn").forEach(b => b.classList.toggle("is-active", b.dataset.route === name));
}

function formatFullName(c) {
  return [c?.lastName, c?.firstName, c?.middleName].filter(Boolean).join(" ").trim() || "—";
}

function statusColorVar(config, statusName) {
  const map = config?.statusColors || {};
  return map[statusName] || "var(--status-closed)";
}

function setStatusBadge(config, statusEl, statusName) {
  statusEl.textContent = statusName || "—";
  statusEl.style.background = statusColorVar(config, statusName || "");
}

function buildFields(config, client) {
  // you wanted ability to add/remove in code -> driven by config.labels.fields keys order
  const labels = config?.labels?.fields || {};
  const order = Object.keys(labels);
  const rows = [];
  for (const key of order) {
    const label = labels[key];
    let value = client?.[key];
    // UX: show plain 3-digit number instead of internal id prefix.
    if (key === "id" && value) value = String(value).replace(/^c/i, "");
    // do not drop numeric 0
    if (value === undefined || value === null || value === "") continue;
    rows.push(`<div class="kv__k">${escapeHtml(label)}</div><div class="kv__v">${escapeHtml(String(value))}</div>`);
  }
  return rows.join("");
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function decodeHtmlEntities(s) {
  // Needed because some dossierData JSON is stored as HTML-escaped text (&quot;...&quot;)
  return String(s ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&");
}

async function renderCurrentClient() {
  const c = getCurrentClient();
  if (!c) return;

  el("clientName").textContent = formatFullName(c);
  el("clientPhoto").src = c.photo || "assets/clients/photos/placeholder.svg";

  setStatusBadge(state.config, el("clientStatus"), c.status);

  el("clientFields").innerHTML = buildFields(state.config, c);

  // dossier
  const dossierEl = el("dossierContainer");
  dossierEl.innerHTML = `<div class="muted">Загрузка досье…</div>`;
  try {
    const html = await fetchText(c.dossier);
    const num = String(c.id || "").replace(/^c/i, "");
    // Make the header consistent even for older dossier files.
    const patched = html
      .replace(/<h2[^>]*>\s*Дело\s*:\s*[^<]*<\/h2>/i, `<h2>Номер клиента: ${escapeHtml(num)}</h2>`)
      .replace(/<h2[^>]*>\s*Номер клиента\s*:\s*[^<]*<\/h2>/i, `<h2>Номер клиента: ${escapeHtml(num)}</h2>`);
    dossierEl.innerHTML = patched;

    // If dossier contains embedded JSON, use it to enrich the client card (e.g. responsible).
    const dataEl = dossierEl.querySelector('#dossierData[type="application/json"]');
    if (dataEl?.textContent) {
      try {
        const payload = JSON.parse(decodeHtmlEntities(dataEl.textContent));
        const d = payload?.dossier || payload || {};
        const cc = payload?.client || {};
        if (d?.responsible != null) c.responsible = d.responsible;
        if ((c.address == null || c.address === "") && cc?.address) c.address = cc.address;
        if ((c.rating == null || c.rating === "") && cc?.rating != null) c.rating = cc.rating;
        // refresh left-top fields
        el("clientFields").innerHTML = buildFields(state.config, c);
      } catch {
        // ignore JSON parse failures
      }
    }
  } catch {
    dossierEl.innerHTML = `<div class="muted">Не удалось загрузить досье: ${escapeHtml(String(c.dossier || ""))}</div>`;
  }

  // transcript
  const trEl = el("transcriptContainer");
  trEl.innerHTML = `<div class="muted">Загрузка расшифровки…</div>`;
  try {
    const txt = await fetchText(c.transcript);
    trEl.innerHTML = renderTranscript(txt);
  } catch {
    trEl.innerHTML = `<div class="muted">Не удалось загрузить расшифровку: ${escapeHtml(String(c.transcript || ""))}</div>`;
  }

  // waveform
  const dt = new Date();
  el("callDatetime").textContent = dt.toLocaleString("ru-RU");
  await state.waveform.load(c.audio);
}

function renderTranscript(txt) {
  // expected "Адвокат: ..." / "Клиент: ..." lines, but tolerant
  const lines = txt.split(/\r?\n/).filter(l => l.trim().length);
  const out = lines.map(line => {
    const m = line.match(/^\s*(адвокат|клиент)\s*:\s*(.*)$/i);
    if (m) {
      const who = m[1].toLowerCase() === "адвокат" ? "lawyer" : "client";
      const label = who === "lawyer" ? "АДВОКАТ" : "КЛИЕНТ";
      const text = m[2] || "";
      return `<div class="line ${who}"><span class="who">${label}</span>${escapeHtml(text)}</div>`;
    }
    return `<div class="line"><span class="who">—</span>${escapeHtml(line)}</div>`;
  });
  return out.join("");
}

function renderClientsList(filterText = "") {
  const list = el("clientsList");
  const ft = filterText.trim().toLowerCase();
  const clients = getClients().filter(c => {
    if (!ft) return true;
      const hay = `${c.firstName || ""} ${c.middleName || ""} ${c.lastName || ""}`.toLowerCase();
    return hay.includes(ft);
  });

  list.innerHTML = clients.map(c => {
    const name = formatFullName(c);
    const status = c.status || "—";
    const num = String(c.id || "").replace(/^c/i, "");
    const responsible = c.responsible || "—";
    const badgeColor = statusColorVar(state.config, status);
    const address = c.address || "";
    return `
      <div class="list__item" data-client-id="${escapeHtml(c.id)}">
        <div class="list__left">
          <img class="list__avatar" src="${escapeHtml(c.photo || "assets/clients/photos/placeholder.svg")}" alt="">
          <div>
            <div class="list__headline">
              <div class="list__name">${escapeHtml(name)}</div>
              <span class="badge badge--outline badge--sm" style="--badge-color:${escapeHtml(badgeColor)}">${escapeHtml(status)}</span>
              <span class="list__clientno">№${escapeHtml(num || "—")}</span>
              <span class="list__responsible" data-resp>${escapeHtml(responsible)}</span>
            </div>
            <div class="list__meta">${escapeHtml(address)}</div>
          </div>
        </div>
        <div class="pill">Open</div>
      </div>
    `;
  }).join("");

  list.querySelectorAll("[data-client-id]").forEach(item => {
    item.addEventListener("click", async () => {
      const id = item.getAttribute("data-client-id");
      setCurrentById(id);
      routeTo("case");
      await renderCurrentClient();
    });
  });

  // Enrich the list with "Ответственный" by parsing embedded dossier JSON.
  // Small dataset (10–20 clients) -> safe to fetch lazily.
  enrichClientsListResponsible(list, clients).catch(() => {});
}

async function enrichClientsListResponsible(listEl, clients) {
  const tasks = [];
  for (const c of clients) {
    if (c?.responsible) continue;
    if (!c?.dossier) continue;

    const item = listEl.querySelector(`[data-client-id="${CSS.escape(String(c.id))}"]`);
    const respEl = item?.querySelector("[data-resp]");
    if (!respEl) continue;

    // Avoid spamming the network for already empty placeholders.
    tasks.push((async () => {
      try {
        const html = await fetchText(c.dossier);
        const doc = new DOMParser().parseFromString(html, "text/html");
        const dataEl = doc.querySelector('#dossierData[type="application/json"]');
        if (!dataEl?.textContent) return;
        const payload = JSON.parse(decodeHtmlEntities(dataEl.textContent));
        const d = payload?.dossier || payload || {};
        const resp = d?.responsible;
        if (!resp) return;
        c.responsible = resp;
        respEl.textContent = String(resp);
      } catch {
        // ignore
      }
    })());
  }
  await Promise.all(tasks);
}

function initClock() {
  const clock = el("nowClock");
  const tick = () => {
    const d = new Date();
    clock.textContent = d.toLocaleTimeString("ru-RU");
  };
  tick();
  setInterval(tick, 1000);
}

function applyConfigToUI(config) {
  el("appTitle").textContent = config?.app?.title || "Адвокатская контора ЮСТАСС";

  // headers optional
  const allowHeaders = config?.app?.allowPanelHeaders ?? true;
  qsa("[data-header]").forEach(h => (h.style.display = allowHeaders ? "flex" : "none"));
}

async function init() {
  state.config = await loadConfig("assets/config.json");
  applyConfigToUI(state.config);

  // theme
  setTheme(getThemeFallback(state.config));
  el("themeToggle").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "light";
    setTheme(cur === "light" ? "dark" : "light");
  });

  initClock();

  // load clients
  await loadClients("assets/clients/clients.json");

    // Incoming call modal
  state.callModal = initIncomingCallModal({
    config: state.config,
    getClients,
    onAcceptClient: async (clientId) => {
      setCurrentById(clientId);
      routeTo("case");
      await renderCurrentClient();
    }
  });

  // splitters
  initSplitters({
    layoutEl: el("caseLayout"),
    splitVEl: el("splitV"),
    splitHEl: el("splitH"),
    initialColLeft: state.config?.layout?.leftColumnPercent ?? 40,
    initialRowTop: state.config?.layout?.topRowPercent ?? 40,
    minPanelPx: state.config?.layout?.minPanelPx ?? 180
  });

  // tabs
  state.tabs = initTabs(document.querySelector('[data-tabs="dossierTabs"]'), "overview");

  // editor
  state.editor = attachRichEditor({
    container: el("dossierContainer"),
    toggleBtn: el("dossierEditToggle")
  });

  // waveform
  state.waveform = createWaveformPlayer({
    canvas: el("waveCanvas"),
    playBtn: el("wavePlayPause"),
    seekEl: el("waveSeek"),
    timecodeEl: el("callTimecode"),
    infoEl: el("waveInfo")
  });

  // prev/next
  el("clientPrev").addEventListener("click", async () => {
    prevClient();
    await renderCurrentClient();
  });
  el("clientNext").addEventListener("click", async () => {
    nextClient();
    await renderCurrentClient();
  });

  // menu navigation
  qsa(".nav__btn").forEach(btn => {
    btn.addEventListener("click", () => routeTo(btn.dataset.route));
  });

  // clients screen search
  const search = el("clientSearch");
  search.addEventListener("input", () => renderClientsList(search.value));

  // route handling
  const go = async () => {
    const r = getRoute() || state.config?.app?.defaultRoute || "case";
    setActiveScreen(r);
    if (r === "case") await renderCurrentClient();
    if (r === "clients") renderClientsList(search.value);
    if (r === "manage") {
      if (!state.admin) {
        state.admin = initClientsAdmin({
          rootEl: el("manageClientsRoot"),
          onOpenClient: async (id) => {
            // convenience: allow opening client card screen from admin
            setCurrentById(id);
            routeTo("case");
            await renderCurrentClient();
          }
        });
      }
      await state.admin.render();
    }
  };

  window.addEventListener("hashchange", go);

  // initial route
  if (!location.hash) routeTo(state.config?.app?.defaultRoute || "case");
  await go();
}

init().catch(err => {
  console.error(err);
  alert("Ошибка инициализации UI. Проверь консоль.");
});

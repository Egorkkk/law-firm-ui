import { qs } from "./util.js";

// Admin UI for creating/editing clients and structured dossier fields.
// Uses server API endpoints (see server.js):
//   GET    /api/clients
//   GET    /api/client/:id
//   POST   /api/client
//   PUT    /api/client/:id
//   DELETE /api/client/:id

const STATUS_OPTIONS = ["Стандарт", "Плюс", "Плюс Про", "ВИП"];

const RESPONSIBLE_OPTIONS = [
  "Котова Людмила",
  "Титов Степан",
  "Поздняков Александр",
  "Бурлов Евгений",
  "Сафонова Ирина",
  "Арутюнов Вагит",
  "Николаев Леонид",
  "Смирнов Геннадий"
];

const PATHS = {
  dossier: (id) => `assets/clients/dossiers/${id}.html`,
  photoSuggested: (id) => `assets/clients/photos/${id}.png`,
  // audio/transcript: we keep id-based paths; files may be placeholders
  audio: (id) => `assets/clients/audio/${id}_call.mp3`,
  transcript: (id) => `assets/clients/transcripts/${id}.txt`,
  photoPlaceholder: () => `assets/clients/photos/placeholder.svg`
};

// Date helpers: UI uses <input type="date"> which expects YYYY-MM-DD.
// We store DOB as DD.MM.YYYY in clients.json.
function toInputDate(dob) {
  const s = String(dob || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // already ISO
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return "";
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

function fromInputDate(val) {
  const s = String(val || "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const yyyy = m[1], mm = m[2], dd = m[3];
  return `${dd}.${mm}.${yyyy}`;
}

export function initClientsAdmin({ rootEl, onOpenClient }) {
  if (!rootEl) throw new Error("initClientsAdmin: rootEl is required");

  const ui = {
    mode: "view", // view | new | edit
    currentId: null,
    data: null
  };

  function renderShell() {
    rootEl.innerHTML = `
      <div class="page__header">
        <div class="page__title">Управление клиентами</div>
        <div class="page__tools admin-tools">
          <button class="btn btn--subtle" id="admNew" type="button">Создать</button>
          <button class="btn" id="admSave" type="button">Сохранить</button>
          <button class="btn btn--ghost" id="admDelete" type="button">Удалить</button>
          <button class="btn btn--ghost" id="admDuplicate" type="button">Дублировать</button>
        </div>
      </div>

      <div class="admin-grid">
        <div class="admin-left">
          <div class="admin-list" id="admList"></div>
        </div>

        <div class="admin-right">
          <div class="admin-form" id="admForm">
            <div class="placeholder">
              <div class="placeholder__title">Выбери клиента слева</div>
              <div class="placeholder__text">Или нажми «Создать», чтобы добавить нового.</div>
            </div>
          </div>
        </div>
      </div>
    `;

    qs("#admNew", rootEl).addEventListener("click", () => startNew());
    qs("#admSave", rootEl).addEventListener("click", () => save());
    qs("#admDelete", rootEl).addEventListener("click", () => remove());
    qs("#admDuplicate", rootEl).addEventListener("click", () => duplicate());
  }

  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json; charset=utf-8" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-cache"
    });

    if (!res.ok) {
      let msg = `${method} ${path} -> ${res.status}`;
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch {}
      throw new Error(msg);
    }

    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return await res.json();
    return await res.text();
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtName(c) {
    const parts = [c?.firstName, c?.middleName, c?.lastName].filter(Boolean);
    return parts.join(" ").trim() || "—";
  }

  function clientIdFromNumber(num) {
    const n = String(num || "").trim();
    if (!/^\d{3}$/.test(n)) return null;
    return `c${n}`;
  }

  function renderList(clients) {
    const listEl = qs("#admList", rootEl);

    listEl.innerHTML = clients.map(c => {
      const name = fmtName(c);
      const status = c.status || "—";
      const num = String(c.id || "").replace(/^c/i, "");
      const meta = [num, status, c.address].filter(Boolean).join(" · ");
      return `
        <div class="list__item admin-list__item" data-client-id="${escapeHtml(c.id)}">
          <div class="list__left">
            <img class="list__avatar" src="${escapeHtml(c.photo || PATHS.photoPlaceholder())}" alt="">
            <div>
              <div class="list__name">${escapeHtml(name)}</div>
              <div class="list__meta">${escapeHtml(meta)}</div>
            </div>
          </div>
          <div class="pill">Open</div>
        </div>
      `;
    }).join("");

    listEl.querySelectorAll("[data-client-id]").forEach(item => {
      item.addEventListener("click", async () => {
        const id = item.getAttribute("data-client-id");
        await openClient(id);
      });
    });
  }

  function renderForm(data) {
    const c = data?.client || {};
    const d = data?.dossier || {};

    const isEdit = ui.mode === "edit";

    const statusOpts = STATUS_OPTIONS.map(s => {
      const sel = (c.status || "") === s ? "selected" : "";
      return `<option value="${escapeHtml(s)}" ${sel}>${escapeHtml(s)}</option>`;
    }).join("");

    const curResp = (d.responsible || "").trim();
    const respList = [...RESPONSIBLE_OPTIONS];
    if (curResp && !respList.includes(curResp)) respList.unshift(curResp);
    const responsibleOpts = respList.map(name => {
      const sel = curResp === name ? "selected" : "";
      return `<option value="${escapeHtml(name)}" ${sel}>${escapeHtml(name)}</option>`;
    }).join("");

    const number = (c.id || "").replace(/^c/i, "");
    const computedId = clientIdFromNumber(number) || "";

    const computedDossier = computedId ? PATHS.dossier(computedId) : "";
    const computedAudio = computedId ? PATHS.audio(computedId) : "";
    const computedTranscript = computedId ? PATHS.transcript(computedId) : "";

    const photoValue = c.photo || PATHS.photoPlaceholder();

    qs("#admForm", rootEl).innerHTML = `
      <div class="admin-form__grid">
        <div class="admin-section">
          <div class="admin-section__title">Клиент</div>

          <div class="admin-row">
            <label class="admin-label" for="admNumber">Номер клиента (3 цифры)</label>
            <input class="input admin-input" id="admNumber" type="text" inputmode="numeric" maxlength="3" value="${escapeHtml(number)}" placeholder="217" />
          </div>

          <div class="admin-row">
            <label class="admin-label" for="admFirst">Имя</label>
            <input class="input admin-input" id="admFirst" type="text" value="${escapeHtml(c.firstName || "")}" />
          </div>

          <div class="admin-row">
            <label class="admin-label" for="admMiddle">Отчество</label>
            <input class="input admin-input" id="admMiddle" type="text" value="${escapeHtml(c.middleName || "")}" />
          </div>

          <div class="admin-row">
            <label class="admin-label" for="admLast">Фамилия</label>
            <input class="input admin-input" id="admLast" type="text" value="${escapeHtml(c.lastName || "")}" />
          </div>

          <div class="admin-row">
            <label class="admin-label" for="admRating">Рейтинг</label>
            <input class="input admin-input" id="admRating" type="number" step="0.1" value="${escapeHtml(c.rating ?? "")}" placeholder="4.7" />
          </div>

          <div class="admin-row">
            <label class="admin-label" for="admStatus">Статус</label>
            <select class="input admin-input" id="admStatus">
              <option value="">—</option>
              ${statusOpts}
            </select>
          </div>

          <div class="admin-row">
            <label class="admin-label" for="admDob">Дата рождения</label>
            <input class="input admin-input" id="admDob" type="date" value="${escapeHtml(toInputDate(c.dob || ""))}" />
          </div>

          <div class="admin-row">
            <label class="admin-label" for="admEmail">Email</label>
            <input class="input admin-input" id="admEmail" type="text" value="${escapeHtml(c.email || "")}" />
          </div>

          <div class="admin-row">
            <label class="admin-label" for="admAddress">Адрес</label>
            <input class="input admin-input" id="admAddress" type="text" value="${escapeHtml(c.address || "")}" placeholder="Одной строкой" />
          </div>

          <div class="admin-row">
            <label class="admin-label" for="admPhoto">Фото (путь)</label>
            <input class="input admin-input" id="admPhoto" type="text" value="${escapeHtml(photoValue)}" />
          </div>

          <div class="admin-row">
            <label class="admin-label" for="admDossierPath">Досье (авто)</label>
            <input class="input admin-input" id="admDossierPath" type="text" value="${escapeHtml(c.dossier || computedDossier)}" disabled />
          </div>

          <div class="admin-row">
            <label class="admin-label" for="admAudioPath">Аудио (заглушка)</label>
            <input class="input admin-input" id="admAudioPath" type="text" value="${escapeHtml(c.audio || computedAudio)}" disabled />
          </div>

          <div class="admin-row">
            <label class="admin-label" for="admTranscriptPath">Транскрипт (заглушка)</label>
            <input class="input admin-input" id="admTranscriptPath" type="text" value="${escapeHtml(c.transcript || computedTranscript)}" disabled />
          </div>
        </div>

        <div class="admin-section">
          <div class="admin-section__title">Досье</div>

          <div class="admin-row">
            <label class="admin-label" for="admSummary">Кратко</label>
            <textarea class="input admin-input admin-textarea" id="admSummary" rows="2">${escapeHtml(d.summary || "")}</textarea>
          </div>

          <div class="admin-row">
            <label class="admin-label" for="admCategory">Категория</label>
            <input class="input admin-input" id="admCategory" type="text" value="${escapeHtml(d.category || "")}" />
          </div>

          <div class="admin-row">
            <label class="admin-label" for="admPriority">Приоритет</label>
            <input class="input admin-input" id="admPriority" type="text" value="${escapeHtml(d.priority || "")}" />
          </div>

          <div class="admin-row">
            <label class="admin-label" for="admResponsible">Ответственный</label>
            <select class="input admin-input" id="admResponsible">
              <option value="">—</option>
              ${responsibleOpts}
            </select>
          </div>

          <div class="admin-row">
            <label class="admin-label" for="admTimeline">Хронология (1 пункт на строку)</label>
            <textarea class="input admin-input admin-textarea" id="admTimeline" rows="5">${escapeHtml((d.timeline || []).join("\n"))}</textarea>
          </div>

          <div class="admin-row">
            <label class="admin-label" for="admNotes">Заметки</label>
            <textarea class="input admin-input admin-textarea" id="admNotes" rows="7">${escapeHtml(d.notes || "")}</textarea>
          </div>

          <div class="admin-actions">
            <button class="btn btn--ghost" id="admOpenCase" type="button">Открыть карточку (Досье)</button>
          </div>
        </div>
      </div>
    `;

    qs("#admOpenCase", rootEl).addEventListener("click", async () => {
      const id = getEditedClientId();
      if (!id) return alert("Нужен номер клиента (3 цифры).");
      onOpenClient?.(id);
    });
  }

  function getEditedClientId() {
    const num = qs("#admNumber", rootEl)?.value;
    return clientIdFromNumber(num);
  }

  function collectForm() {
    const id = getEditedClientId();
    if (!id) throw new Error("Номер клиента должен быть 3 цифры (например 217).");

    const client = {
      id,
      firstName: qs("#admFirst", rootEl)?.value?.trim() || "",
      middleName: qs("#admMiddle", rootEl)?.value?.trim() || "",
      lastName: qs("#admLast", rootEl)?.value?.trim() || "",
      rating: (() => {
        const v = qs("#admRating", rootEl)?.value;
        if (v === "" || v == null) return "";
        const n = Number(v);
        return Number.isFinite(n) ? n : "";
      })(),
      status: qs("#admStatus", rootEl)?.value || "",
      dob: fromInputDate(qs("#admDob", rootEl)?.value || ""),
      email: qs("#admEmail", rootEl)?.value?.trim() || "",
      address: qs("#admAddress", rootEl)?.value?.trim() || "",
      photo: qs("#admPhoto", rootEl)?.value?.trim() || ""
    };

    // paths are auto-managed on the server, but we still include them in payload
    // so dossier can embed full client JSON.
    client.dossier = PATHS.dossier(id);
    client.audio = PATHS.audio(id);
    client.transcript = PATHS.transcript(id);

    const dossier = {
      summary: qs("#admSummary", rootEl)?.value || "",
      category: qs("#admCategory", rootEl)?.value?.trim() || "",
      priority: qs("#admPriority", rootEl)?.value?.trim() || "",
      responsible: qs("#admResponsible", rootEl)?.value?.trim() || "",
      timeline: (qs("#admTimeline", rootEl)?.value || "")
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean),
      notes: qs("#admNotes", rootEl)?.value || ""
    };

    return { client, dossier };
  }

  async function openClient(id) {
    ui.mode = "edit";
    ui.currentId = id;
    ui.data = await api(`/api/client/${encodeURIComponent(id)}`);
    renderForm(ui.data);
  }

  function startNew() {
    ui.mode = "new";
    ui.currentId = null;
    ui.data = {
      client: {
        id: "",
        firstName: "",
        middleName: "",
        lastName: "",
        rating: "",
        status: "",
        dob: "",
        email: "",
        address: "",
        photo: PATHS.photoPlaceholder(),
        dossier: "",
        audio: "",
        transcript: ""
      },
      dossier: {
        summary: "",
        category: "",
        priority: "",
        responsible: "",
        timeline: [],
        notes: ""
      }
    };
    renderForm(ui.data);
    const numEl = qs("#admNumber", rootEl);
    numEl?.focus();
  }

  async function save() {
    try {
      const payload = collectForm();
      const id = payload.client.id;

      if (ui.mode === "new") {
        await api("/api/client", { method: "POST", body: payload });
      } else {
        const oldId = ui.currentId || id;
        await api(`/api/client/${encodeURIComponent(oldId)}`, { method: "PUT", body: payload });
      }

      // requirement: reload after save
      location.reload();
    } catch (e) {
      alert(String(e?.message || e));
    }
  }

  async function remove() {
    try {
      const id = ui.mode === "edit" ? ui.currentId : getEditedClientId();
      if (!id) return alert("Нужен номер клиента (3 цифры).");
      if (!confirm(`Удалить клиента ${id}? Будут удалены досье и фото.`)) return;
      await api(`/api/client/${encodeURIComponent(id)}`, { method: "DELETE" });
      location.reload();
    } catch (e) {
      alert(String(e?.message || e));
    }
  }

  function duplicate() {
    // Keep current form values, but force new 3-digit id.
    if (!qs("#admForm", rootEl)?.querySelector("#admNumber")) return;
    ui.mode = "new";
    ui.currentId = null;

    const num = qs("#admNumber", rootEl);
    if (num) {
      num.disabled = false;
      num.value = "";
      num.focus();
    }

    alert("Введите новый номер клиента (3 цифры) и нажмите «Сохранить».\nПути досье/аудио/транскрипта будут рассчитаны автоматически.");
  }

  async function render() {
    if (!rootEl.dataset._mounted) {
      renderShell();
      rootEl.dataset._mounted = "1";
    }

    const clients = await api("/api/clients");
    renderList(Array.isArray(clients) ? clients : []);

    // auto-open first client for convenience
    if (!ui.currentId && clients?.length) {
      await openClient(clients[0].id);
    }
  }

  return { render };
}

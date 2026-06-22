(function () {
  "use strict";

  const LS_KEY = "sharoshiMaster.v1";
  const MASTERS = {
    staff: {
      label: "スタッフ", key: "code",
      fields: [{ k: "code", label: "社員番号" }, { k: "name", label: "氏名" }],
      hint: "工数入力で使うスタッフ（社員番号・氏名）を管理します。"
    },
    customers: {
      label: "顧客", key: "code",
      fields: [{ k: "code", label: "顧客番号" }, { k: "name", label: "顧客名" }],
      hint: "顧問先（顧客番号・顧客名）を管理します。"
    },
    tasks: {
      label: "業務区分", key: "name",
      fields: [{ k: "name", label: "業務区分名" }],
      hint: "工数入力・作業登録のプルダウンに出る業務区分を管理します。"
    },
    items: {
      label: "品目（請求項目）", key: "code",
      fields: [{ k: "code", label: "品目コード" }, { k: "name", label: "品目名" }],
      hint: "請求データの品目（請求項目）コード表を管理します。"
    }
  };

  const state = { staff: [], customers: [], tasks: [], items: [] };
  let active = "staff";
  let editingKey = "";

  const el = {
    tabs: Array.from(document.querySelectorAll(".tab[data-master]")),
    hint: document.getElementById("masterHint"),
    form: document.getElementById("masterForm"),
    search: document.getElementById("masterSearch"),
    count: document.getElementById("masterCount"),
    head: document.getElementById("masterHead"),
    body: document.getElementById("masterBody"),
    reload: document.getElementById("reload"),
    status: document.getElementById("dataStatus"),
    toast: document.getElementById("toast")
  };

  init();

  async function init() {
    el.tabs.forEach((t) => t.addEventListener("click", () => switchMaster(t.dataset.master)));
    el.reload.addEventListener("click", reload);
    el.search.addEventListener("input", renderList);
    el.form.addEventListener("submit", onSubmit);
    el.body.addEventListener("click", onBodyClick);
    await load();
  }

  function isRemote() {
    return Boolean(window.WorklogBackend && window.WorklogBackend.isRemote());
  }

  async function load() {
    setStatus("読み込み中…");
    let loaded = false;
    if (isRemote()) {
      try {
        const st = await window.WorklogBackend.loadState();
        if (st) {
          state.staff = normPair(st.staff);
          state.customers = normPair(st.customers);
          state.tasks = (Array.isArray(st.taskTypes) ? st.taskTypes : [])
            .map((n) => ({ name: String(n || "").trim() })).filter((x) => x.name);
          state.items = normPair(st.items);
          loaded = true;
          setStatus("スプレッドシートから読み込みました");
        }
      } catch (error) {
        setStatus("読み込み失敗: " + error.message);
        showToast(error.message);
      }
    }
    if (!loaded) { loadLocal(); setStatus("ローカルデータを表示中（未接続）"); }
    renderAll();
  }

  async function reload() {
    if (editingKey) resetForm();
    await load();
  }

  function normPair(items) {
    return (Array.isArray(items) ? items : [])
      .map((it) => ({ code: String(it.code || "").trim(), name: String(it.name || "").trim() }))
      .filter((it) => it.code && it.name);
  }

  function switchMaster(type) {
    if (!MASTERS[type]) return;
    active = type;
    editingKey = "";
    el.search.value = "";
    el.tabs.forEach((t) => {
      const on = t.dataset.master === type;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", String(on));
    });
    renderAll();
  }

  function renderAll() {
    el.hint.textContent = MASTERS[active].hint;
    renderForm();
    renderHead();
    renderList();
  }

  function renderForm() {
    const def = MASTERS[active];
    const editing = Boolean(editingKey);
    const inputs = def.fields.map((f) => {
      const ro = editing && f.k === def.key ? "" : "";
      return `<label>${esc(f.label)}<input type="text" data-f="${esc(f.k)}" id="mf_${esc(f.k)}"${ro}></label>`;
    }).join("");
    el.form.className = "master-edit-form" + (editing ? " is-editing" : "");
    el.form.innerHTML = `${inputs}
      <div class="form-buttons">
        <button type="submit" class="primary">${editing ? "更新" : "追加"}</button>
        ${editing ? '<button type="button" class="secondary" id="mfCancel">取消</button>' : ""}
      </div>`;
    const cancel = document.getElementById("mfCancel");
    if (cancel) cancel.addEventListener("click", resetForm);
  }

  function renderHead() {
    const def = MASTERS[active];
    const cols = def.fields.map((f, i) => `<th class="${i === 0 ? "col-key" : ""}">${esc(f.label)}</th>`).join("");
    el.head.innerHTML = `<tr>${cols}<th class="ops">操作</th></tr>`;
  }

  function renderList() {
    const def = MASTERS[active];
    const q = el.search.value.trim().toLowerCase();
    const all = state[active];
    const rows = all.filter((r) => {
      if (!q) return true;
      return def.fields.some((f) => String(r[f.k] || "").toLowerCase().includes(q));
    }).slice().sort((a, b) => String(a[def.key]).localeCompare(String(b[def.key]), "ja"));

    if (!rows.length) {
      el.body.innerHTML = `<tr><td class="grid-empty" colspan="${def.fields.length + 1}">${all.length ? "該当するデータがありません。" : "登録がありません。フォームから追加できます。"}</td></tr>`;
    } else {
      el.body.innerHTML = rows.map((r) => {
        const cells = def.fields.map((f, i) => `<td class="${i === 0 ? "col-key" : ""}">${esc(r[f.k] || "")}</td>`).join("");
        const key = esc(r[def.key]);
        return `<tr data-key="${key}">${cells}
          <td class="ops">
            <button type="button" class="row-edit" data-edit>編集</button>
            <button type="button" class="row-del" data-del>削除</button>
          </td></tr>`;
      }).join("");
    }
    el.count.textContent = `${rows.length} / ${all.length} 件`;
  }

  function onBodyClick(event) {
    const tr = event.target.closest("tr[data-key]");
    if (!tr) return;
    const key = tr.dataset.key;
    if (event.target.closest("[data-edit]")) startEdit(key);
    else if (event.target.closest("[data-del]")) removeItem(key);
  }

  function startEdit(key) {
    const def = MASTERS[active];
    const item = state[active].find((r) => String(r[def.key]) === String(key));
    if (!item) return;
    editingKey = key;
    renderForm();
    def.fields.forEach((f) => {
      const input = document.getElementById("mf_" + f.k);
      if (input) input.value = item[f.k] || "";
    });
    const first = el.form.querySelector("input");
    if (first) first.focus();
  }

  function resetForm() {
    editingKey = "";
    renderForm();
  }

  async function onSubmit(event) {
    event.preventDefault();
    const def = MASTERS[active];
    const item = {};
    for (const f of def.fields) {
      const input = document.getElementById("mf_" + f.k);
      item[f.k] = String((input && input.value) || "").replace(/\s+/g, " ").trim();
      if (!item[f.k]) { showToast(`${f.label}を入力してください`); return; }
    }
    const keyVal = item[def.key];
    const dupKey = state[active].some((r) => String(r[def.key]) === keyVal && String(r[def.key]) !== String(editingKey));
    if (dupKey) { showToast(`${def.fields[0].label}が重複しています`); return; }

    try {
      await window.WorklogBackend.upsertMaster(active, item, editingKey || "");
    } catch (error) {
      showToast(error.message);
      return;
    }
    applyUpsert(item, editingKey);
    persistLocal();
    const wasEditing = Boolean(editingKey);
    editingKey = "";
    renderAll();
    showToast(wasEditing ? "更新しました" : "追加しました");
  }

  function applyUpsert(item, oldKey) {
    const def = MASTERS[active];
    const list = state[active];
    if (oldKey && String(oldKey) !== String(item[def.key])) {
      const i = list.findIndex((r) => String(r[def.key]) === String(oldKey));
      if (i >= 0) list.splice(i, 1);
    }
    const existing = list.find((r) => String(r[def.key]) === String(item[def.key]));
    if (existing) def.fields.forEach((f) => { existing[f.k] = item[f.k]; });
    else list.push(Object.assign({}, item));
  }

  async function removeItem(key) {
    const def = MASTERS[active];
    const item = state[active].find((r) => String(r[def.key]) === String(key));
    if (!item) return;
    const label = def.fields.map((f) => item[f.k]).join(" ");
    if (!window.confirm(`${label} を削除しますか？（入力済みデータは残ります）`)) return;
    try {
      await window.WorklogBackend.removeMaster(active, key);
    } catch (error) {
      showToast(error.message);
      return;
    }
    state[active] = state[active].filter((r) => String(r[def.key]) !== String(key));
    if (String(editingKey) === String(key)) editingKey = "";
    persistLocal();
    renderAll();
    showToast("削除しました");
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      state.staff = normPair(p.staff);
      state.customers = normPair(p.customers);
      state.tasks = (Array.isArray(p.tasks) ? p.tasks : []).map((x) => ({ name: String((x && x.name) || x || "").trim() })).filter((x) => x.name);
      state.items = normPair(p.items);
    } catch (error) { /* 失敗時は空のまま */ }
  }

  function persistLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (error) { /* 続行 */ }
  }

  function setStatus(t) { el.status.textContent = t; }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  let toastTimer = null;
  function showToast(message) {
    window.clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.classList.add("show");
    toastTimer = window.setTimeout(() => el.toast.classList.remove("show"), 2400);
  }
})();

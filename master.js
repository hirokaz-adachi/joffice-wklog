(function () {
  "use strict";

  // 案2: 業務区分は code+name+配賦区分(allocationType)＋工程比(Prepare/Review)。
  //       顧客担当タブ(assignees)は顧客×Prepare/Review担当を編集する。
  //       staff/customers/items は従来どおりの汎用エディタ。

  const ALLOC_LABELS = { service: "役務", excluded: "対象外", tax: "消費税" };
  const GENERIC = {
    staff: { label: "スタッフ", key: "code", fields: [{ k: "code", label: "社員番号" }, { k: "name", label: "氏名" }], hint: "工数入力で使うスタッフ（社員番号・氏名）を管理します。" },
    customers: { label: "顧客", key: "code", fields: [{ k: "code", label: "顧客番号" }, { k: "name", label: "顧客名" }], hint: "顧問先（顧客番号・顧客名）を管理します。" },
    items: { label: "品目（請求項目）", key: "code", fields: [{ k: "code", label: "品目コード" }, { k: "name", label: "品目名" }], hint: "請求データの品目（請求項目）コード表を管理します。" }
  };

  const state = { staff: [], customers: [], items: [], tasks: [], taskPhases: [], customerStaff: [], settings: {} };
  const OFFSET_LABELS = { "0": "当月請求（オフセット0）", "1": "翌月請求（+1）", "2": "翌々月請求（+2）" };
  let active = "staff";
  let editingKey = "";

  const el = {
    tabs: Array.from(document.querySelectorAll(".tab[data-master]")),
    hint: document.getElementById("masterHint"),
    form: document.getElementById("masterForm"),
    searchWrap: document.querySelector(".master-search"),
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

  function isRemote() { return Boolean(window.WorklogBackend && window.WorklogBackend.isRemote()); }

  async function load() {
    setStatus("読み込み中…");
    if (!isRemote()) { setStatus("未接続（config.js を設定してください）"); renderAll(); return; }
    try {
      const st = await window.WorklogBackend.loadState();
      if (st) {
        state.staff = normPair(st.staff);
        state.customers = normPair(st.customers);
        state.items = normPair(st.items);
        state.tasks = (Array.isArray(st.tasks) ? st.tasks : []).map((t) => ({
          code: String(t.code || "").trim(), name: String(t.name || "").trim(),
          allocationType: t.allocationType || "service"
        })).filter((t) => t.code);
        state.taskPhases = (Array.isArray(st.taskPhases) ? st.taskPhases : []).map((p) => ({
          taskCode: String(p.taskCode), phaseCode: String(p.phaseCode), phaseName: p.phaseName,
          ratio: Number(p.ratio || 0), sortOrder: Number(p.sortOrder || 0)
        }));
        state.customerStaff = (Array.isArray(st.customerStaff) ? st.customerStaff : []).map((c) => ({
          customerCode: String(c.customerCode), staffCode: String(c.staffCode || ""), role: String(c.role || ""),
          effectiveFrom: String(c.effectiveFrom || ""), sortOrder: Number(c.sortOrder || 0)
        }));
        state.settings = (st.settings && typeof st.settings === "object") ? st.settings : {};
        setStatus("スプレッドシートから読み込みました");
      }
    } catch (error) {
      setStatus("読み込み失敗: " + error.message);
      showToast(error.message);
    }
    renderAll();
  }

  async function reload() { editingKey = ""; await load(); }

  function normPair(items) {
    return (Array.isArray(items) ? items : [])
      .map((it) => ({ code: String(it.code || "").trim(), name: String(it.name || "").trim() }))
      .filter((it) => it.code && it.name);
  }

  function switchMaster(type) {
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
    if (active === "assignees") return renderAssignees();
    if (active === "tasks") return renderTasks();
    if (active === "settings") return renderSettings();
    return renderGeneric();
  }

  // 設定（作業→請求オフセット）
  function renderSettings() {
    el.searchWrap.style.display = "none";
    el.form.style.display = "";
    el.hint.textContent = "作業月→請求月のオフセット（事務所一律）。請求月 B の売上に対し、作業月 = B − オフセット の工数を対応づけます。基本は0（当月）。";
    const cur = String((state.settings && state.settings.billingOffset) != null ? state.settings.billingOffset : "0");
    el.form.className = "master-edit-form is-tasks";
    el.form.innerHTML = `
      <label>作業→請求オフセット<select id="mf_offset">
        ${["0", "1", "2"].map((v) => `<option value="${v}"${v === cur ? " selected" : ""}>${esc(OFFSET_LABELS[v])}</option>`).join("")}
      </select></label>
      <div class="form-buttons"><button type="submit" class="primary">保存</button></div>`;
    el.head.innerHTML = "";
    el.body.innerHTML = "";
    el.count.textContent = "";
  }

  async function submitSettings() {
    const v = document.getElementById("mf_offset").value;
    try { await window.WorklogBackend.saveSetting("billingOffset", v); }
    catch (error) { showToast(error.message); return; }
    state.settings = Object.assign({}, state.settings, { billingOffset: v });
    showToast("設定を保存しました");
  }

  // ---------------- 汎用（staff/customers/items） ----------------
  function renderGeneric() {
    const def = GENERIC[active];
    el.form.style.display = "";
    el.searchWrap.style.display = "";
    el.hint.textContent = def.hint;
    const editing = Boolean(editingKey);
    el.form.className = "master-edit-form" + (editing ? " is-editing" : "");
    el.form.innerHTML = def.fields.map((f) => `<label>${esc(f.label)}<input type="text" data-f="${esc(f.k)}" id="mf_${esc(f.k)}"></label>`).join("")
      + `<div class="form-buttons"><button type="submit" class="primary">${editing ? "更新" : "追加"}</button>${editing ? '<button type="button" class="secondary" id="mfCancel">取消</button>' : ""}</div>`;
    const cancel = document.getElementById("mfCancel");
    if (cancel) cancel.addEventListener("click", resetForm);
    el.head.innerHTML = `<tr>${def.fields.map((f, i) => `<th class="${i === 0 ? "col-key" : ""}">${esc(f.label)}</th>`).join("")}<th class="ops">操作</th></tr>`;
    renderList();
    if (editingKey) {
      const item = state[active].find((r) => String(r[def.key]) === String(editingKey));
      if (item) def.fields.forEach((f) => { const i = document.getElementById("mf_" + f.k); if (i) i.value = item[f.k] || ""; });
    }
  }

  function renderList() {
    if (active === "assignees" || active === "tasks") return;
    const def = GENERIC[active];
    const q = el.search.value.trim().toLowerCase();
    const all = state[active];
    const rows = all.filter((r) => !q || def.fields.some((f) => String(r[f.k] || "").toLowerCase().includes(q)))
      .slice().sort((a, b) => String(a[def.key]).localeCompare(String(b[def.key]), "ja"));
    if (!rows.length) {
      el.body.innerHTML = `<tr><td class="grid-empty" colspan="${def.fields.length + 1}">${all.length ? "該当するデータがありません。" : "登録がありません。"}</td></tr>`;
    } else {
      el.body.innerHTML = rows.map((r) => {
        const cells = def.fields.map((f, i) => `<td class="${i === 0 ? "col-key" : ""}">${esc(r[f.k] || "")}</td>`).join("");
        return `<tr data-key="${esc(r[def.key])}">${cells}<td class="ops"><button type="button" class="row-edit" data-edit>編集</button><button type="button" class="row-del" data-del>削除</button></td></tr>`;
      }).join("");
    }
    el.count.textContent = `${rows.length} / ${all.length} 件`;
  }

  // ---------------- 業務区分・工程（tasks） ----------------
  function phaseRatio(code, phaseCode) {
    const p = state.taskPhases.find((x) => x.taskCode === String(code) && x.phaseCode === phaseCode);
    return p ? p.ratio : (phaseCode === "PRE" ? 100 : 0);
  }

  function renderTasks() {
    el.form.style.display = "";
    el.searchWrap.style.display = "";
    el.hint.textContent = "業務コード＝請求の業務コード（恒等）。配賦区分（役務／対象外／消費税）と、役務の工程比（Prepare/Review・合計100）を管理します。";
    const editing = Boolean(editingKey);
    el.form.className = "master-edit-form is-tasks" + (editing ? " is-editing" : "");
    el.form.innerHTML = `
      <label>業務コード<input type="text" id="mf_code"></label>
      <label>名称<input type="text" id="mf_name"></label>
      <label>配賦区分<select id="mf_alloc">
        <option value="service">役務</option>
        <option value="excluded">対象外（立替）</option>
        <option value="tax">消費税</option>
      </select></label>
      <label class="phase-input">Prepare%<input type="number" id="mf_pre" min="0" max="100" step="1" value="100"></label>
      <label class="phase-input">Review%<input type="number" id="mf_rev" min="0" max="100" step="1" value="0"></label>
      <div class="form-buttons"><button type="submit" class="primary">${editing ? "更新" : "追加"}</button>${editing ? '<button type="button" class="secondary" id="mfCancel">取消</button>' : ""}</div>`;
    const allocSel = document.getElementById("mf_alloc");
    allocSel.addEventListener("change", togglePhaseInputs);
    const cancel = document.getElementById("mfCancel");
    if (cancel) cancel.addEventListener("click", resetForm);

    if (editing) {
      const t = state.tasks.find((x) => x.code === String(editingKey));
      if (t) {
        document.getElementById("mf_code").value = t.code;
        document.getElementById("mf_name").value = t.name;
        allocSel.value = t.allocationType || "service";
        document.getElementById("mf_pre").value = phaseRatio(t.code, "PRE");
        document.getElementById("mf_rev").value = phaseRatio(t.code, "REV");
      }
    }
    togglePhaseInputs();

    el.head.innerHTML = `<tr><th class="col-key">業務コード</th><th>名称</th><th>配賦区分</th><th class="num">P%</th><th class="num">R%</th><th class="ops">操作</th></tr>`;
    const q = el.search.value.trim().toLowerCase();
    const rows = state.tasks.filter((t) => !q || (t.code + " " + t.name).toLowerCase().includes(q))
      .slice().sort((a, b) => a.code.localeCompare(b.code, "ja"));
    el.body.innerHTML = rows.length ? rows.map((t) => {
      const isSvc = t.allocationType === "service";
      return `<tr data-key="${esc(t.code)}">
        <td class="col-key">${esc(t.code)}</td>
        <td>${esc(t.name)}</td>
        <td>${esc(ALLOC_LABELS[t.allocationType] || t.allocationType)}</td>
        <td class="num">${isSvc ? phaseRatio(t.code, "PRE") : "—"}</td>
        <td class="num">${isSvc ? phaseRatio(t.code, "REV") : "—"}</td>
        <td class="ops"><button type="button" class="row-edit" data-edit>編集</button><button type="button" class="row-del" data-del>削除</button></td></tr>`;
    }).join("") : `<tr><td class="grid-empty" colspan="6">登録がありません。</td></tr>`;
    el.count.textContent = `${rows.length} / ${state.tasks.length} 件`;
  }

  function togglePhaseInputs() {
    const svc = document.getElementById("mf_alloc").value === "service";
    el.form.querySelectorAll(".phase-input").forEach((n) => { n.style.display = svc ? "" : "none"; });
  }

  async function submitTask() {
    const code = clean(document.getElementById("mf_code").value);
    const name = clean(document.getElementById("mf_name").value);
    const alloc = document.getElementById("mf_alloc").value;
    if (!code || !name) { showToast("業務コードと名称を入力してください"); return; }
    const dup = state.tasks.some((t) => t.code === code && t.code !== String(editingKey));
    if (dup) { showToast("業務コードが重複しています"); return; }
    let pre = 100, rev = 0;
    if (alloc === "service") {
      pre = Number(document.getElementById("mf_pre").value || 0);
      rev = Number(document.getElementById("mf_rev").value || 0);
      if (Math.round(pre + rev) !== 100) { showToast("工程比の合計を100にしてください（現在 " + (pre + rev) + "）"); return; }
    }
    try {
      await window.WorklogBackend.upsertMaster("tasks", { code, name, allocationType: alloc }, editingKey || "");
      if (editingKey && String(editingKey) !== code) {
        await window.WorklogBackend.deleteTaskPhase(String(editingKey), "PRE");
        await window.WorklogBackend.deleteTaskPhase(String(editingKey), "REV");
      }
      if (alloc === "service") {
        await window.WorklogBackend.saveTaskPhases([
          { taskCode: code, phaseCode: "PRE", phaseName: "Prepare", ratio: pre, sortOrder: 1 },
          { taskCode: code, phaseCode: "REV", phaseName: "Review", ratio: rev, sortOrder: 2 }
        ]);
      }
    } catch (error) { showToast(error.message); return; }

    // ローカル反映
    const old = editingKey;
    if (old && String(old) !== code) {
      state.tasks = state.tasks.filter((t) => t.code !== String(old));
      state.taskPhases = state.taskPhases.filter((p) => p.taskCode !== String(old));
    }
    const ex = state.tasks.find((t) => t.code === code);
    if (ex) { ex.name = name; ex.allocationType = alloc; } else state.tasks.push({ code, name, allocationType: alloc });
    state.taskPhases = state.taskPhases.filter((p) => p.taskCode !== code);
    if (alloc === "service") {
      state.taskPhases.push({ taskCode: code, phaseCode: "PRE", phaseName: "Prepare", ratio: pre, sortOrder: 1 });
      state.taskPhases.push({ taskCode: code, phaseCode: "REV", phaseName: "Review", ratio: rev, sortOrder: 2 });
    }
    const wasEditing = Boolean(editingKey);
    editingKey = "";
    renderTasks();
    showToast(wasEditing ? "更新しました" : "追加しました");
  }

  // ---------------- 顧客担当（assignees・時系列） ----------------
  // 対象月を選び、その月時点の担当を表示・編集する。保存は「その月から有効」。差分のみ保持。
  function currentMonth() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
  function resolvedStaff(custCode, role, month, rows) {
    const src = rows || state.customerStaff;
    const a = window.JOfficeAllocation ? window.JOfficeAllocation.assigneesAsOf(src, custCode, month) : {};
    return (a[role] || [])[0] || "";
  }
  // この月の指定を除いた継承値（前月以前から有効なもの）。
  function inheritedStaff(custCode, role, month) {
    const subset = state.customerStaff.filter((x) => String(x.effectiveFrom || "") !== month);
    return resolvedStaff(custCode, role, month, subset);
  }
  function thisMonthRow(custCode, role, month) {
    return state.customerStaff.find((x) => x.customerCode === String(custCode) && x.role === role && String(x.effectiveFrom || "") === month);
  }

  function renderAssignees() {
    el.form.style.display = "none";
    el.searchWrap.style.display = "";
    if (!state.assigneeMonth) state.assigneeMonth = currentMonth();
    const month = state.assigneeMonth;
    el.hint.innerHTML = `対象月 <input type="month" id="assigneeMonth" value="${esc(month)}"> 時点の担当を表示・編集します。保存は<b>その月から有効</b>（未計上枠は担当へフォールバック配賦）。`
      + `<span class="eff-tag eff-this">この月〜</span>=当月から指定 / <span class="eff-tag eff-inh">引継</span>=前月以前から継続。`;
    el.head.innerHTML = `<tr><th class="col-key">顧客番号</th><th>顧客名</th><th>Prepare担当</th><th>Review担当</th><th class="ops">操作</th></tr>`;
    const q = el.search.value.trim().toLowerCase();
    const rows = state.customers.filter((c) => !q || (c.code + " " + c.name).toLowerCase().includes(q))
      .slice().sort((a, b) => a.code.localeCompare(b.code, "ja"));
    const opts = (sel) => `<option value="">—（担当なし）</option>` + state.staff.slice()
      .sort((a, b) => a.code.localeCompare(b.code, "ja"))
      .map((s) => `<option value="${esc(s.code)}"${s.code === sel ? " selected" : ""}>${esc(s.code)} ${esc(s.name)}</option>`).join("");
    const cell = (c, role) => {
      const val = resolvedStaff(c.code, role, month);
      const tag = thisMonthRow(c.code, role, month) ? `<span class="eff-tag eff-this">この月〜</span>`
        : (val ? `<span class="eff-tag eff-inh">引継</span>` : `<span class="eff-tag eff-none">未設定</span>`);
      return `<td><div class="assignee-cell"><select data-role="${role}">${opts(val)}</select>${tag}</div></td>`;
    };
    el.body.innerHTML = rows.length ? rows.map((c) => {
      const hasTm = thisMonthRow(c.code, "PRE", month) || thisMonthRow(c.code, "REV", month);
      return `<tr data-key="${esc(c.code)}">
        <td class="col-key">${esc(c.code)}</td>
        <td>${esc(c.name)}</td>
        ${cell(c, "PRE")}
        ${cell(c, "REV")}
        <td class="ops"><button type="button" class="row-edit" data-save>保存</button>${hasTm ? `<button type="button" class="row-revert" data-revert>当月取消</button>` : ""}</td></tr>`;
    }).join("") : `<tr><td class="grid-empty" colspan="5">顧客がありません。</td></tr>`;
    el.count.textContent = `${rows.length} / ${state.customers.length} 件（${month} 時点）`;
    const mi = document.getElementById("assigneeMonth");
    if (mi) mi.onchange = () => { state.assigneeMonth = mi.value || currentMonth(); renderAssignees(); };
  }

  async function saveAssignee(custCode, tr) {
    const month = state.assigneeMonth;
    try {
      await applyRoleChange(custCode, "PRE", tr.querySelector('select[data-role="PRE"]').value, 1, month);
      await applyRoleChange(custCode, "REV", tr.querySelector('select[data-role="REV"]').value, 2, month);
    } catch (error) { showToast(error.message); return; }
    showToast(`${month} 以降の担当を保存しました`);
    renderAssignees();
  }

  // 選択値が継承値と同じなら当月行は作らず（既存があれば削除）、異なれば当月から有効の指定を upsert。
  async function applyRoleChange(custCode, role, chosen, sortOrder, month) {
    const dropLocal = () => { state.customerStaff = state.customerStaff.filter((x) => !(x.customerCode === String(custCode) && x.role === role && String(x.effectiveFrom || "") === month)); };
    if (chosen === inheritedStaff(custCode, role, month)) {
      if (thisMonthRow(custCode, role, month)) {
        await window.WorklogBackend.deleteCustomerStaff(custCode, role, month);
        dropLocal();
      }
      return;
    }
    await window.WorklogBackend.saveCustomerStaff({ customerCode: String(custCode), staffCode: chosen, role, effectiveFrom: month, sortOrder });
    dropLocal();
    state.customerStaff.push({ customerCode: String(custCode), staffCode: chosen, role, effectiveFrom: month, sortOrder });
  }

  // 当月の指定（PRE/REV）を取り消し、前月以前の担当に戻す。
  async function revertMonth(custCode) {
    const month = state.assigneeMonth;
    try {
      for (let i = 0; i < 2; i += 1) {
        const role = i === 0 ? "PRE" : "REV";
        if (thisMonthRow(custCode, role, month)) {
          await window.WorklogBackend.deleteCustomerStaff(custCode, role, month);
          state.customerStaff = state.customerStaff.filter((x) => !(x.customerCode === String(custCode) && x.role === role && String(x.effectiveFrom || "") === month));
        }
      }
    } catch (error) { showToast(error.message); return; }
    showToast(`${month} の指定を取り消しました`);
    renderAssignees();
  }

  // ---------------- 共通イベント ----------------
  function onBodyClick(event) {
    const tr = event.target.closest("tr[data-key]");
    if (!tr) return;
    const key = tr.dataset.key;
    if (active === "assignees") {
      if (event.target.closest("[data-revert]")) revertMonth(key);
      else if (event.target.closest("[data-save]")) saveAssignee(key, tr);
      return;
    }
    if (event.target.closest("[data-edit]")) startEdit(key);
    else if (event.target.closest("[data-del]")) removeItem(key);
  }

  function startEdit(key) { editingKey = key; renderAll(); const f = el.form.querySelector("input"); if (f) f.focus(); }
  function resetForm() { editingKey = ""; renderAll(); }

  async function onSubmit(event) {
    event.preventDefault();
    if (active === "tasks") return submitTask();
    if (active === "settings") return submitSettings();
    if (active === "assignees") return;
    const def = GENERIC[active];
    const item = {};
    for (const f of def.fields) {
      item[f.k] = clean((document.getElementById("mf_" + f.k) || {}).value || "");
      if (!item[f.k]) { showToast(`${f.label}を入力してください`); return; }
    }
    if (state[active].some((r) => String(r[def.key]) === item[def.key] && String(r[def.key]) !== String(editingKey))) {
      showToast(`${def.fields[0].label}が重複しています`); return;
    }
    try { await window.WorklogBackend.upsertMaster(active, item, editingKey || ""); }
    catch (error) { showToast(error.message); return; }
    const old = editingKey;
    if (old && String(old) !== String(item[def.key])) state[active] = state[active].filter((r) => String(r[def.key]) !== String(old));
    const ex = state[active].find((r) => String(r[def.key]) === String(item[def.key]));
    if (ex) def.fields.forEach((f) => { ex[f.k] = item[f.k]; }); else state[active].push(Object.assign({}, item));
    const wasEditing = Boolean(editingKey);
    editingKey = "";
    renderGeneric();
    showToast(wasEditing ? "更新しました" : "追加しました");
  }

  async function removeItem(key) {
    if (active === "tasks") {
      const t = state.tasks.find((x) => x.code === String(key));
      if (!t || !window.confirm(`${t.code} ${t.name} を削除しますか？`)) return;
      try {
        await window.WorklogBackend.removeMaster("tasks", key);
        await window.WorklogBackend.deleteTaskPhase(String(key), "PRE");
        await window.WorklogBackend.deleteTaskPhase(String(key), "REV");
      } catch (error) { showToast(error.message); return; }
      state.tasks = state.tasks.filter((x) => x.code !== String(key));
      state.taskPhases = state.taskPhases.filter((p) => p.taskCode !== String(key));
      if (String(editingKey) === String(key)) editingKey = "";
      renderTasks();
      showToast("削除しました");
      return;
    }
    const def = GENERIC[active];
    const item = state[active].find((r) => String(r[def.key]) === String(key));
    if (!item || !window.confirm(`${def.fields.map((f) => item[f.k]).join(" ")} を削除しますか？`)) return;
    try { await window.WorklogBackend.removeMaster(active, key); }
    catch (error) { showToast(error.message); return; }
    state[active] = state[active].filter((r) => String(r[def.key]) !== String(key));
    if (String(editingKey) === String(key)) editingKey = "";
    renderGeneric();
    showToast("削除しました");
  }

  function setStatus(t) { el.status.textContent = t; }
  function clean(v) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim(); }
  function esc(value) {
    return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  let toastTimer = null;
  function showToast(message) {
    window.clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.classList.add("show");
    toastTimer = window.setTimeout(() => el.toast.classList.remove("show"), 2400);
  }
})();

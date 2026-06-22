(function () {
  "use strict";

  const LS_KEY = "sharoshiDataEdit.v1";
  const TASK_INTERNAL = "社内/その他";
  const DEFAULT_TASKS = ["顧問対応", "給与計算", "手続き", "労務相談", "助成金", "スポット", TASK_INTERNAL];

  const state = { staff: [], customers: [], taskTypes: DEFAULT_TASKS.slice(), work: [], bill: [] };
  const dirtyWork = new Set();
  const dirtyBill = new Set();
  const newWork = new Set();
  const newBill = new Set();
  let activeTab = "work";

  const el = {
    tabWork: document.getElementById("tabWork"),
    tabBill: document.getElementById("tabBill"),
    panelWork: document.getElementById("panelWork"),
    panelBill: document.getElementById("panelBill"),
    workBody: document.getElementById("workBody"),
    billBody: document.getElementById("billBody"),
    addRow: document.getElementById("addRow"),
    saveAll: document.getElementById("saveAll"),
    reload: document.getElementById("reload"),
    dirtyInfo: document.getElementById("dirtyInfo"),
    status: document.getElementById("dataStatus"),
    wFrom: document.getElementById("wFrom"),
    wTo: document.getElementById("wTo"),
    wStaff: document.getElementById("wStaff"),
    wCust: document.getElementById("wCust"),
    wClear: document.getElementById("wClear"),
    wCount: document.getElementById("wCount"),
    bFrom: document.getElementById("bFrom"),
    bTo: document.getElementById("bTo"),
    bCust: document.getElementById("bCust"),
    bClear: document.getElementById("bClear"),
    bCount: document.getElementById("bCount"),
    toast: document.getElementById("toast")
  };

  init();

  async function init() {
    bindEvents();
    await load();
  }

  function bindEvents() {
    el.tabWork.addEventListener("click", () => switchTab("work"));
    el.tabBill.addEventListener("click", () => switchTab("bill"));
    el.addRow.addEventListener("click", addRow);
    el.saveAll.addEventListener("click", saveAll);
    el.reload.addEventListener("click", reload);
    [el.workBody, el.billBody].forEach((body) => {
      body.addEventListener("input", onCellInput);
      body.addEventListener("change", onCellInput);
      body.addEventListener("click", onBodyClick);
    });
    [el.wFrom, el.wTo, el.wStaff, el.wCust].forEach((x) => x.addEventListener("input", renderWork));
    [el.bFrom, el.bTo, el.bCust].forEach((x) => x.addEventListener("input", renderBill));
    el.wClear.addEventListener("click", clearWorkFilter);
    el.bClear.addEventListener("click", clearBillFilter);
  }

  function isRemote() {
    return Boolean(window.WorklogBackend && window.WorklogBackend.isRemote());
  }

  async function load() {
    setStatus("読み込み中…");
    let loaded = false;
    if (isRemote()) {
      try {
        const [st, db] = await Promise.all([
          window.WorklogBackend.loadState(),
          window.WorklogBackend.loadDashboard(true)
        ]);
        if (st) {
          state.staff = normMaster(st.staff);
          state.customers = normMaster(st.customers);
          state.taskTypes = Array.isArray(st.taskTypes) && st.taskTypes.length ? st.taskTypes : DEFAULT_TASKS.slice();
          state.work = (st.entries || []).map(normWork);
        }
        if (db) {
          if (!state.staff.length && db.staff) state.staff = normMaster(db.staff);
          if (!state.customers.length && db.customers) state.customers = normMaster(db.customers);
          state.bill = (db.billing || []).map(normBill);
        }
        loaded = true;
        setStatus("スプレッドシートから読み込みました");
      } catch (error) {
        setStatus("読み込み失敗: " + error.message);
        showToast(error.message);
      }
    }
    if (!loaded) {
      loadLocal();
      setStatus("ローカルデータを表示中（未接続）");
    }
    clearDirty();
    fillFilters();
    renderAll();
  }

  async function reload() {
    if (dirtyWork.size + dirtyBill.size > 0) {
      const ok = window.confirm("未保存の変更があります。破棄して再読込しますか？");
      if (!ok) return;
    }
    await load();
  }

  function normMaster(items) {
    return (Array.isArray(items) ? items : [])
      .map((it) => ({ code: String(it.code || "").trim(), name: String(it.name || "").trim() }))
      .filter((it) => it.code && it.name);
  }

  function normWork(e) {
    return {
      id: e.id || makeId(),
      date: String(e.date || "").slice(0, 10),
      staffCode: e.staffCode || "",
      staff: e.staff || "",
      customerCode: e.customerCode || "",
      customer: e.customer || "",
      taskType: e.taskType || "",
      hours: Number(e.hours || 0),
      memo: e.memo || "",
      updatedAt: e.updatedAt || ""
    };
  }

  function normBill(b) {
    return {
      invoiceId: String(b.invoiceId || makeInvoiceId()),
      billingMonth: String(b.billingMonth || "").slice(0, 7),
      customerCode: b.customerCode || "",
      customer: b.customer || "",
      invoiceItem: b.invoiceItem || "",
      paymentMethod: b.paymentMethod || "",
      netAmount: Number(b.netAmount || 0),
      taxAmount: Number(b.taxAmount || 0),
      grossAmount: Number(b.grossAmount || 0),
      issuedDate: String(b.issuedDate || "").slice(0, 10),
      paymentDueDate: String(b.paymentDueDate || "").slice(0, 10),
      paymentStatus: b.paymentStatus || "",
      memo: b.memo || ""
    };
  }

  function switchTab(tab) {
    activeTab = tab;
    const work = tab === "work";
    el.tabWork.classList.toggle("is-active", work);
    el.tabBill.classList.toggle("is-active", !work);
    el.tabWork.setAttribute("aria-selected", String(work));
    el.tabBill.setAttribute("aria-selected", String(!work));
    el.panelWork.hidden = !work;
    el.panelBill.hidden = work;
  }

  function renderAll() {
    renderWork();
    renderBill();
    updateDirtyInfo();
  }

  function renderWork() {
    const rows = state.work.filter(matchWork).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (!rows.length) {
      const msg = state.work.length ? "条件に一致する工数がありません。" : "工数データがありません。「＋ 行を追加」で追加できます。";
      el.workBody.innerHTML = `<tr><td class="grid-empty" colspan="7">${msg}</td></tr>`;
    } else {
      el.workBody.innerHTML = rows.map(workRowHtml).join("");
    }
    if (el.wCount) el.wCount.textContent = `${rows.length} / ${state.work.length} 件`;
  }

  function renderBill() {
    const rows = state.bill.filter(matchBill).sort((a, b) => String(b.billingMonth).localeCompare(String(a.billingMonth)));
    if (!rows.length) {
      const msg = state.bill.length ? "条件に一致する売上がありません。" : "売上データがありません。「＋ 行を追加」で追加できます。";
      el.billBody.innerHTML = `<tr><td class="grid-empty" colspan="13">${msg}</td></tr>`;
    } else {
      el.billBody.innerHTML = rows.map(billRowHtml).join("");
    }
    if (el.bCount) el.bCount.textContent = `${rows.length} / ${state.bill.length} 件`;
  }

  function matchWork(r) {
    if (newWork.has(r.id)) return true;
    const from = el.wFrom.value, to = el.wTo.value, staff = el.wStaff.value, cust = el.wCust.value;
    if (from && (!r.date || r.date < from)) return false;
    if (to && (!r.date || r.date > to)) return false;
    if (staff && staff !== "すべて" && r.staffCode !== staff) return false;
    if (cust && cust !== "すべて" && r.customerCode !== cust) return false;
    return true;
  }

  function matchBill(r) {
    if (newBill.has(r.invoiceId)) return true;
    const from = el.bFrom.value, to = el.bTo.value, cust = el.bCust.value;
    if (from && (!r.billingMonth || r.billingMonth < from)) return false;
    if (to && (!r.billingMonth || r.billingMonth > to)) return false;
    if (cust && cust !== "すべて" && r.customerCode !== cust) return false;
    return true;
  }

  function fillFilters() {
    const cw = el.wStaff.value;
    el.wStaff.innerHTML = [`<option value="すべて">スタッフ：すべて</option>`]
      .concat(state.staff.map((sf) => `<option value="${esc(sf.code)}">${esc(sf.code)} ${esc(sf.name)}</option>`)).join("");
    el.wStaff.value = Array.from(el.wStaff.options).some((o) => o.value === cw) ? cw : "すべて";
    const cc = el.bCust.value;
    el.bCust.innerHTML = [`<option value="すべて">顧客：すべて</option>`]
      .concat(state.customers.map((c) => `<option value="${esc(c.code)}">${esc(c.code)} ${esc(c.name)}</option>`)).join("");
    el.bCust.value = Array.from(el.bCust.options).some((o) => o.value === cc) ? cc : "すべて";
    const wc = el.wCust.value;
    el.wCust.innerHTML = [`<option value="すべて">顧客：すべて</option>`]
      .concat(state.customers.map((c) => `<option value="${esc(c.code)}">${esc(c.code)} ${esc(c.name)}</option>`)).join("");
    el.wCust.value = Array.from(el.wCust.options).some((o) => o.value === wc) ? wc : "すべて";
  }

  function clearWorkFilter() {
    el.wFrom.value = ""; el.wTo.value = ""; el.wStaff.value = "すべて"; el.wCust.value = "すべて"; renderWork();
  }

  function clearBillFilter() {
    el.bFrom.value = ""; el.bTo.value = ""; el.bCust.value = "すべて"; renderBill();
  }

  function rowClass(kind, id) {
    const isNew = kind === "work" ? newWork.has(id) : newBill.has(id);
    if (isNew) return "is-new";
    const dirty = kind === "work" ? dirtyWork.has(id) : dirtyBill.has(id);
    return dirty ? "is-dirty" : "";
  }

  function workRowHtml(r) {
    return `<tr data-kind="work" data-id="${esc(r.id)}" class="${rowClass("work", r.id)}">
      <td class="col-date"><input type="date" data-f="date" value="${esc(r.date)}"></td>
      <td class="col-staff">${staffSelect(r.staffCode)}</td>
      <td class="col-customer">${customerSelect(r.customerCode)}</td>
      <td class="col-task">${taskSelect(r.taskType)}</td>
      <td class="col-hours num"><input class="cell-num" type="number" step="0.25" min="0" data-f="hours" value="${numAttr(r.hours)}"></td>
      <td class="col-memo"><input type="text" data-f="memo" value="${esc(r.memo)}"></td>
      <td class="col-ops"><button type="button" class="row-del" data-del>削除</button></td>
    </tr>`;
  }

  function billRowHtml(r) {
    return `<tr data-kind="bill" data-id="${esc(r.invoiceId)}" class="${rowClass("bill", r.invoiceId)}">
      <td class="col-invid"><span class="cell-id">${esc(r.invoiceId)}</span></td>
      <td class="col-month"><input type="month" data-f="billingMonth" value="${esc(r.billingMonth)}"></td>
      <td class="col-customer">${customerSelect(r.customerCode)}</td>
      <td class="col-item"><input type="text" data-f="invoiceItem" value="${esc(r.invoiceItem)}"></td>
      <td class="col-pay"><input type="text" data-f="paymentMethod" value="${esc(r.paymentMethod)}"></td>
      <td class="col-amt num"><input class="cell-num" type="number" step="1" data-f="netAmount" value="${numAttr(r.netAmount)}"></td>
      <td class="col-amt num"><input class="cell-num" type="number" step="1" data-f="taxAmount" value="${numAttr(r.taxAmount)}"></td>
      <td class="col-amt num"><input class="cell-num" type="number" step="1" data-f="grossAmount" value="${numAttr(r.grossAmount)}"></td>
      <td class="col-date2"><input type="date" data-f="issuedDate" value="${esc(r.issuedDate)}"></td>
      <td class="col-date2"><input type="date" data-f="paymentDueDate" value="${esc(r.paymentDueDate)}"></td>
      <td class="col-status"><input type="text" data-f="paymentStatus" value="${esc(r.paymentStatus)}"></td>
      <td class="col-memo"><input type="text" data-f="memo" value="${esc(r.memo)}"></td>
      <td class="col-ops"><button type="button" class="row-del" data-del>削除</button></td>
    </tr>`;
  }

  function staffSelect(code) {
    const opts = [`<option value="">（選択）</option>`].concat(
      state.staff.map((s) => opt(s.code, `${s.code} ${s.name}`, s.code === code))
    );
    if (code && !state.staff.some((s) => s.code === code)) opts.push(opt(code, code, true));
    return `<select data-f="staffCode">${opts.join("")}</select>`;
  }

  function customerSelect(code) {
    const opts = [opt("", "顧客指定なし", !code)].concat(
      state.customers.map((c) => opt(c.code, `${c.code} ${c.name}`, c.code === code))
    );
    if (code && !state.customers.some((c) => c.code === code)) opts.push(opt(code, code, true));
    return `<select data-f="customerCode">${opts.join("")}</select>`;
  }

  function taskSelect(value) {
    const list = state.taskTypes.slice();
    if (value && !list.includes(value)) list.push(value);
    return `<select data-f="taskType">${list.map((t) => opt(t, t, t === value)).join("")}</select>`;
  }

  function opt(value, label, selected) {
    return `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
  }

  function onCellInput(event) {
    const target = event.target;
    const field = target.dataset && target.dataset.f;
    if (!field) return;
    const tr = target.closest("tr");
    if (!tr) return;
    const kind = tr.dataset.kind;
    const id = tr.dataset.id;
    const row = findRow(kind, id);
    if (!row) return;

    let value = target.value;
    if (field === "hours" || field === "netAmount" || field === "taxAmount" || field === "grossAmount") {
      value = Number(value || 0);
    }
    row[field] = value;

    // 売上: 税抜・消費税の変更時に税込を自動計算（手動上書き前の補助）
    if (kind === "bill" && (field === "netAmount" || field === "taxAmount")) {
      row.grossAmount = Number(row.netAmount || 0) + Number(row.taxAmount || 0);
      const grossInput = tr.querySelector('[data-f="grossAmount"]');
      if (grossInput) grossInput.value = numAttr(row.grossAmount);
    }

    markDirty(kind, id, tr);
  }

  function onBodyClick(event) {
    const btn = event.target.closest("[data-del]");
    if (!btn) return;
    const tr = btn.closest("tr");
    deleteRow(tr.dataset.kind, tr.dataset.id, tr);
  }

  async function deleteRow(kind, id, tr) {
    const isNewRow = kind === "work" ? newWork.has(id) : newBill.has(id);
    if (isNewRow) {
      removeRow(kind, id);
      tr.remove();
      forgetDirty(kind, id);
      if (kind === "work" && !state.work.length) renderWork();
      if (kind === "bill" && !state.bill.length) renderBill();
      persistLocal();
      updateDirtyInfo();
      return;
    }
    const ok = window.confirm("保存済みのデータを削除します。よろしいですか？");
    if (!ok) return;
    try {
      if (kind === "work") await window.WorklogBackend.deleteEntry(id);
      else await window.WorklogBackend.deleteBilling(id);
    } catch (error) {
      showToast(error.message);
      return;
    }
    removeRow(kind, id);
    forgetDirty(kind, id);
    tr.remove();
    if (kind === "work" && !state.work.length) renderWork();
    if (kind === "bill" && !state.bill.length) renderBill();
    persistLocal();
    updateDirtyInfo();
    showToast("削除しました");
  }

  function addRow() {
    if (activeTab === "work") {
      const r = normWork({ id: makeId(), date: today(), taskType: state.taskTypes[0] || "顧問対応", hours: 1 });
      state.work.unshift(r);
      newWork.add(r.id);
      dirtyWork.add(r.id);
      renderWork();
    } else {
      const r = normBill({ invoiceId: makeInvoiceId(), billingMonth: currentMonth() });
      state.bill.unshift(r);
      newBill.add(r.invoiceId);
      dirtyBill.add(r.invoiceId);
      renderBill();
    }
    updateDirtyInfo();
    showToast("行を追加しました（保存で確定）");
  }

  async function saveAll() {
    const workToSave = [];
    for (const id of dirtyWork) {
      const r = findRow("work", id);
      if (!r) continue;
      const requiresCustomer = r.taskType !== TASK_INTERNAL;
      if (!r.date || !r.staffCode || !r.taskType || !(Number(r.hours) > 0) || (requiresCustomer && !r.customerCode)) {
        showToast("工数：未入力または時間の値を確認してください");
        switchTab("work");
        return;
      }
      workToSave.push({
        id: r.id,
        date: r.date,
        staffCode: r.staffCode,
        staff: masterName("staff", r.staffCode),
        customerCode: r.customerCode,
        customer: r.customerCode ? masterName("customers", r.customerCode) : "",
        taskType: r.taskType,
        hours: Number(r.hours),
        memo: r.memo || "",
        updatedAt: new Date().toISOString()
      });
    }

    const billToSave = [];
    for (const id of dirtyBill) {
      const r = findRow("bill", id);
      if (!r) continue;
      if (!r.billingMonth || !Number.isFinite(Number(r.netAmount))) {
        showToast("売上：請求月と税抜金額を確認してください");
        switchTab("bill");
        return;
      }
      billToSave.push({
        invoiceId: r.invoiceId,
        billingMonth: r.billingMonth,
        customerCode: r.customerCode,
        customer: r.customerCode ? masterName("customers", r.customerCode) : "",
        invoiceItem: r.invoiceItem || "",
        paymentMethod: r.paymentMethod || "",
        netAmount: Number(r.netAmount || 0),
        taxAmount: Number(r.taxAmount || 0),
        grossAmount: Number(r.grossAmount || (Number(r.netAmount || 0) + Number(r.taxAmount || 0))),
        issuedDate: r.issuedDate || "",
        paymentDueDate: r.paymentDueDate || "",
        paymentStatus: r.paymentStatus || "",
        memo: r.memo || ""
      });
    }

    if (workToSave.length === 0 && billToSave.length === 0) {
      showToast("保存する変更がありません");
      return;
    }

    el.saveAll.disabled = true;
    try {
      if (workToSave.length) await window.WorklogBackend.saveEntries(workToSave);
      if (billToSave.length) await window.WorklogBackend.saveBillings(billToSave);
    } catch (error) {
      showToast(error.message);
      el.saveAll.disabled = false;
      return;
    }
    el.saveAll.disabled = false;

    // ローカル状態を保存値で更新（名称解決済みの値を反映）
    workToSave.forEach((e) => {
      const idx = state.work.findIndex((w) => w.id === e.id);
      if (idx >= 0) state.work[idx] = normWork(e); else state.work.push(normWork(e));
    });
    billToSave.forEach((b) => {
      const idx = state.bill.findIndex((x) => x.invoiceId === b.invoiceId);
      if (idx >= 0) state.bill[idx] = normBill(b); else state.bill.push(normBill(b));
    });

    clearDirty();
    persistLocal();
    renderAll();
    showToast(`保存しました（工数${workToSave.length}件・売上${billToSave.length}件）`);
  }

  function findRow(kind, id) {
    return kind === "work"
      ? state.work.find((r) => r.id === id)
      : state.bill.find((r) => r.invoiceId === id);
  }

  function removeRow(kind, id) {
    if (kind === "work") state.work = state.work.filter((r) => r.id !== id);
    else state.bill = state.bill.filter((r) => r.invoiceId !== id);
  }

  function markDirty(kind, id, tr) {
    (kind === "work" ? dirtyWork : dirtyBill).add(id);
    if (tr && !tr.classList.contains("is-new")) tr.classList.add("is-dirty");
    updateDirtyInfo();
  }

  function forgetDirty(kind, id) {
    if (kind === "work") { dirtyWork.delete(id); newWork.delete(id); }
    else { dirtyBill.delete(id); newBill.delete(id); }
  }

  function clearDirty() {
    dirtyWork.clear(); dirtyBill.clear(); newWork.clear(); newBill.clear();
  }

  function updateDirtyInfo() {
    const n = dirtyWork.size + dirtyBill.size;
    el.dirtyInfo.textContent = n ? `未保存 ${n}件` : "";
    el.saveAll.classList.toggle("secondary", n === 0);
  }

  function masterName(type, code) {
    const list = type === "staff" ? state.staff : state.customers;
    return (list.find((it) => it.code === code) || {}).name || code;
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) { state.taskTypes = DEFAULT_TASKS.slice(); return; }
      const p = JSON.parse(raw);
      state.staff = normMaster(p.staff);
      state.customers = normMaster(p.customers);
      state.taskTypes = Array.isArray(p.taskTypes) && p.taskTypes.length ? p.taskTypes : DEFAULT_TASKS.slice();
      state.work = (p.work || []).map(normWork);
      state.bill = (p.bill || []).map(normBill);
    } catch (error) {
      state.taskTypes = DEFAULT_TASKS.slice();
    }
  }

  function persistLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        staff: state.staff, customers: state.customers, taskTypes: state.taskTypes,
        work: state.work, bill: state.bill
      }));
    } catch (error) { /* localStorage不可でも続行 */ }
  }

  function setStatus(text) { el.status.textContent = text; }

  function makeId() { return `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function makeInvoiceId() { return `INV_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`; }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function currentMonth() { return today().slice(0, 7); }

  function numAttr(v) {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : "0";
  }

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

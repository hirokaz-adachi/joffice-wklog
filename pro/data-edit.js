(function () {
  "use strict";

  const LS_KEY = "sharoshiDataEdit.v1";
  const TASK_INTERNAL = "社内/その他";
  const DEFAULT_TASKS = ["顧問対応", "給与計算", "手続き", "労務相談", "助成金", "スポット", TASK_INTERNAL];

  const state = { staff: [], customers: [], taskTypes: DEFAULT_TASKS.slice(), customerStaff: [], taskPhases: [], tasks: [], work: [], bill: [] };
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
    csvImport: document.getElementById("csvImport"),
    csvFile: document.getElementById("csvFile"),
    csvModal: document.getElementById("csvModal"),
    csvClose: document.getElementById("csvClose"),
    csvCancel: document.getElementById("csvCancel"),
    csvConfirm: document.getElementById("csvConfirm"),
    csvMonth: document.getElementById("csvMonth"),
    csvTransfer: document.getElementById("csvTransfer"),
    csvSummary: document.getElementById("csvSummary"),
    csvWarn: document.getElementById("csvWarn"),
    csvPreviewBody: document.getElementById("csvPreviewBody"),
    toast: document.getElementById("toast")
  };

  // CSV取込プレビューの作業用ステート（確定前の解析結果を保持）
  let csvDraft = null;

  init();

  async function init() {
    bindEvents();
    await load();
  }

  function bindEvents() {
    // 請求（billing）専念。工数の訂正は工数管理画面（worklog.html）へ。
    el.addRow.addEventListener("click", addRow);
    el.saveAll.addEventListener("click", saveAll);
    el.reload.addEventListener("click", reload);
    el.billBody.addEventListener("input", onCellInput);
    el.billBody.addEventListener("change", onCellInput);
    el.billBody.addEventListener("click", onBodyClick);
    [el.bFrom, el.bTo, el.bCust].forEach((x) => x.addEventListener("input", renderBill));
    el.bClear.addEventListener("click", clearBillFilter);
    // CSV取込（かつ・かいしゅう 口座振替CSV・Shift-JIS）
    el.csvImport.addEventListener("click", () => el.csvFile.click());
    el.csvFile.addEventListener("change", onCsvFile);
    el.csvClose.addEventListener("click", closeCsvModal);
    el.csvCancel.addEventListener("click", closeCsvModal);
    el.csvConfirm.addEventListener("click", confirmCsvImport);
    el.csvMonth.addEventListener("change", onCsvMonthChange);
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
          state.customerStaff = (Array.isArray(st.customerStaff) ? st.customerStaff : [])
            .map((c) => ({ customerCode: String(c.customerCode), staffCode: String(c.staffCode || ""), role: String(c.role || ""), effectiveFrom: String(c.effectiveFrom || "") }));
          state.taskPhases = (Array.isArray(st.taskPhases) ? st.taskPhases : [])
            .map((p) => ({ taskCode: String(p.taskCode), phaseCode: String(p.phaseCode), ratio: Number(p.ratio || 0), sortOrder: Number(p.sortOrder || 0) }));
          state.tasks = (Array.isArray(st.tasks) ? st.tasks : [])
            .map((t) => ({ code: normCode(t.code), name: String(t.name || ""), allocationType: String(t.allocationType || "service") })).filter((t) => t.code && t.name);
          state.work = (st.entries || []).map(normWork);
        }
        if (db) {
          if (!state.staff.length && db.staff) state.staff = normMaster(db.staff);
          if (!state.customers.length && db.customers) state.customers = normMaster(db.customers);
          if (!state.tasks.length && Array.isArray(db.tasks)) {
            state.tasks = db.tasks.map((t) => ({ code: normCode(t.code), name: String(t.name || ""), allocationType: String(t.allocationType || "service") })).filter((t) => t.code && t.name);
          }
          state.bill = (db.billing || []).map(normBill);
        }
        loaded = true;
        setStatus("読み込みました");
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
      .map((it) => ({ code: String(it.code || "").trim(), name: String(it.name || "").trim(), isActive: (it.isActive === 0 || it.isActive === false || it.isActive === "0") ? 0 : 1 }))
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
      taskCode: e.taskCode == null ? "" : String(e.taskCode),
      phaseCode: e.phaseCode == null ? "" : String(e.phaseCode),
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
      invoiceItemCode: b.invoiceItemCode == null ? "" : String(b.invoiceItemCode),
      transferDate: String(b.transferDate || "").slice(0, 10),
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
    renderBill();
    updateDirtyInfo();
  }

  function renderWork() {
    const rows = state.work.filter(matchWork).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (!rows.length) {
      const msg = state.work.length ? "条件に一致する工数がありません。" : "工数データがありません。「＋ 行を追加」で追加できます。";
      el.workBody.innerHTML = `<tr><td class="grid-empty" colspan="9">${msg}</td></tr>`;
    } else {
      el.workBody.innerHTML = rows.map(workRowHtml).join("");
    }
    if (el.wCount) el.wCount.textContent = `${rows.length} / ${state.work.length} 件`;
  }

  function renderBill() {
    const rows = state.bill.filter(matchBill).sort((a, b) => String(b.billingMonth).localeCompare(String(a.billingMonth)));
    if (!rows.length) {
      const msg = state.bill.length ? "条件に一致する売上がありません。" : "売上データがありません。「＋ 行を追加」で追加できます。";
      el.billBody.innerHTML = `<tr><td class="grid-empty" colspan="15">${msg}</td></tr>`;
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
    if (!el.bFrom.value && !el.bTo.value) {
      el.bFrom.value = currentMonth();
      el.bTo.value = currentMonth();
    }
    const cc = el.bCust.value;
    el.bCust.innerHTML = [`<option value="すべて">顧客：すべて</option>`]
      .concat(state.customers.map((c) => `<option value="${esc(c.code)}">${esc(c.code)} ${esc(c.name)}</option>`)).join("");
    el.bCust.value = Array.from(el.bCust.options).some((o) => o.value === cc) ? cc : "すべて";
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
      <td class="col-customer">${customerSelect(r.customerCode, r.staffCode, monthOf(r.date))}</td>
      <td class="col-task">${taskSelect(r.taskType)}</td>
      <td class="col-code"><input type="text" data-f="taskCode" value="${esc(r.taskCode)}" placeholder="業務コード"></td>
      ${phaseTd(r)}
      <td class="col-hours num"><input class="cell-num" type="number" step="0.25" min="0" data-f="hours" value="${numAttr(r.hours)}"></td>
      <td class="col-memo"><textarea data-f="memo" rows="1">${esc(r.memo)}</textarea></td>
      <td class="col-ops"><button type="button" class="row-del" data-del>削除</button></td>
    </tr>`;
  }

  function billRowHtml(r) {
    return `<tr data-kind="bill" data-id="${esc(r.invoiceId)}" class="${rowClass("bill", r.invoiceId)}">
      <td class="col-invid"><span class="cell-id">${esc(r.invoiceId)}</span></td>
      <td class="col-month"><input type="month" data-f="billingMonth" value="${esc(r.billingMonth)}"></td>
      <td class="col-customer">${customerSelect(r.customerCode)}</td>
      <td class="col-code"><input type="text" data-f="invoiceItemCode" value="${esc(r.invoiceItemCode)}" placeholder="業務コード"></td>
      <td class="col-item"><input type="text" data-f="invoiceItem" value="${esc(r.invoiceItem)}"></td>
      <td class="col-pay"><input type="text" data-f="paymentMethod" value="${esc(r.paymentMethod)}"></td>
      <td class="col-amt num"><input class="cell-num" type="number" step="1" data-f="netAmount" value="${numAttr(r.netAmount)}"></td>
      <td class="col-amt num"><input class="cell-num" type="number" step="1" data-f="taxAmount" value="${numAttr(r.taxAmount)}"></td>
      <td class="col-amt num"><input class="cell-num" type="number" step="1" data-f="grossAmount" value="${numAttr(r.grossAmount)}"></td>
      <td class="col-date2"><input type="date" data-f="transferDate" value="${esc(r.transferDate)}"></td>
      <td class="col-date2"><input type="date" data-f="issuedDate" value="${esc(r.issuedDate)}"></td>
      <td class="col-date2"><input type="date" data-f="paymentDueDate" value="${esc(r.paymentDueDate)}"></td>
      <td class="col-status"><input type="text" data-f="paymentStatus" value="${esc(r.paymentStatus)}"></td>
      <td class="col-memo"><textarea data-f="memo" rows="1">${esc(r.memo)}</textarea></td>
      <td class="col-ops"><button type="button" class="row-del" data-del>削除</button></td>
    </tr>`;
  }

  function staffSelect(code) {
    const opts = [`<option value="">（選択）</option>`].concat(
      state.staff.filter((s) => s.isActive !== 0 || s.code === code)
        .map((s) => opt(s.code, `${s.code} ${s.name}${s.isActive === 0 ? "（無効）" : ""}`, s.code === code))
    );
    // 現在値が無効/未登録なら補填＝編集救済。
    if (code && !state.staff.some((s) => s.code === code)) opts.push(opt(code, code, true));
    return `<select data-f="staffCode">${opts.join("")}</select>`;
  }

  // 顧客担当は時系列マスタ。行の日付の月時点で解決する（staffCode 無指定はフラット＝売上行用）。
  function monthOf(d) { return String(d || "").slice(0, 7); }
  function roleFor(staffCode, custCode, month) {
    if (!staffCode || !custCode) return "";
    return window.JOfficeAllocation ? window.JOfficeAllocation.roleAsOf(state.customerStaff || [], custCode, staffCode, month || "") : "";
  }
  function groupedCustomers(staffCode, month) {
    const roleMap = window.JOfficeAllocation
      ? window.JOfficeAllocation.resolveAssignees(state.customerStaff || [], month || "").roleByCustomerStaff
      : new Map();
    const pre = [], rev = [], other = [];
    // 行編集の候補は有効顧客のみ（現在値が無効/未登録の場合は customerSelect 側で補填）。
    state.customers.filter((c) => c.isActive !== 0).forEach((c) => {
      const role = (roleMap.get(String(c.code)) || {})[String(staffCode)] || "";
      if (role === "PRE") pre.push(c);
      else if (role === "REV") rev.push(c);
      else other.push(c);
    });
    const byCode = (a, b) => String(a.code).localeCompare(String(b.code), "ja");
    return { pre: pre.sort(byCode), rev: rev.sort(byCode), other: other.sort(byCode) };
  }

  function customerSelect(code, staffCode, month) {
    const label = (c, role) => `${c.code} ${c.name}${role ? ` (${role === "PRE" ? "Pre" : "Rev"})` : ""}`;
    let body = opt("", "顧客指定なし", !code);
    if (staffCode) {
      const g = groupedCustomers(staffCode, month);
      if (g.pre.length || g.rev.length) {
        body += `<optgroup label="担当顧客">`
          + g.pre.map((c) => opt(c.code, label(c, "PRE"), c.code === code)).join("")
          + g.rev.map((c) => opt(c.code, label(c, "REV"), c.code === code)).join("")
          + `</optgroup>`;
      }
      if (g.other.length) {
        body += `<optgroup label="その他">` + g.other.map((c) => opt(c.code, label(c, ""), c.code === code)).join("") + `</optgroup>`;
      }
    } else {
      body += state.customers.filter((c) => c.isActive !== 0 || c.code === code)
        .map((c) => opt(c.code, `${c.code} ${c.name}${c.isActive === 0 ? "（無効）" : ""}`, c.code === code)).join("");
    }
    // 現在値が無効顧客 or 未登録の場合は選択肢へ補填＝編集救済（過去請求の編集を妨げない）。
    if (code && !state.customers.some((c) => c.code === code && c.isActive !== 0)) {
      const cc = state.customers.find((c) => c.code === code);
      body += opt(code, cc ? `${cc.code} ${cc.name}（無効）` : code, true);
    }
    return `<select data-f="customerCode">${body}</select>`;
  }

  function taskSelect(value) {
    const list = state.taskTypes.slice();
    if (value && !list.includes(value)) list.push(value);
    return `<select data-f="taskType">${list.map((t) => opt(t, t, t === value)).join("")}</select>`;
  }

  // コード正規化（数値は3桁ゼロ埋め）。マスタとの突合を安定させる。
  function normCode(v) {
    const s = String(v == null ? "" : v).trim();
    return /^\d+$/.test(s) ? s.padStart(3, "0") : s;
  }
  // その業務区分の有効工程（ratio>0）。未マッピングは null。
  function validPhases(taskCode) {
    const key = normCode(taskCode);
    if (!key) return null;
    const ph = state.taskPhases.filter((p) => normCode(p.taskCode) === key && Number(p.ratio) > 0);
    if (!ph.length) return null;
    return ph.slice().sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)).map((p) => p.phaseCode);
  }
  function phaseName(code) { return code === "PRE" ? "Prepare" : code === "REV" ? "Review" : code; }
  // 業務区分マスタ（名↔コード）。名称変更時にコードを、コード変更時に名称を追従させる。
  function nameToCode(name) { const t = state.tasks.find((x) => x.name === name); return t ? t.code : ""; }
  function codeToName(code) { const t = state.tasks.find((x) => x.code === normCode(code)); return t ? t.name : ""; }

  // 案2: 工程は「その業務区分の有効工程」のみ選択肢に（単一工程ならPreのみ＝実質固定）。
  // 既存の不正値は「（不一致）」として残し、見えて直せるようにする（保存時の暗黙書換えを避ける）。
  function phaseSelect(value, taskCode) {
    const vp = validPhases(taskCode);
    const opts = [opt("", "—", !value)];
    if (vp) {
      vp.forEach((code) => opts.push(opt(code, phaseName(code), value === code)));
      if (value && !vp.includes(value)) opts.push(opt(value, phaseName(value) + "（不一致）", true));
    } else {
      opts.push(opt("PRE", "Prepare", value === "PRE"));
      opts.push(opt("REV", "Review", value === "REV"));
      if (value && value !== "PRE" && value !== "REV") opts.push(opt(value, value, true));
    }
    return `<select data-f="phaseCode">${opts.join("")}</select>`;
  }

  // 案1相当: 担当役割と工程の不一致（二工程の業務区分のみ判定。単一工程/未マッピングは対象外）。
  function phaseMismatch(r) {
    const role = roleFor(r.staffCode, r.customerCode, monthOf(r.date));
    if (!role || !r.phaseCode) return false;
    const vp = validPhases(r.taskCode);
    if (!vp || vp.length < 2) return false;
    return role !== r.phaseCode;
  }
  function phaseTd(r) {
    if (phaseMismatch(r)) {
      const role = roleFor(r.staffCode, r.customerCode, monthOf(r.date));
      const title = `担当役割（${phaseName(role)}）と工程（${phaseName(r.phaseCode)}）が一致しません`;
      return `<td class="col-phase is-mismatch" title="${esc(title)}">${phaseSelect(r.phaseCode, r.taskCode)}</td>`;
    }
    return `<td class="col-phase">${phaseSelect(r.phaseCode, r.taskCode)}</td>`;
  }
  function applyPhaseMismatch(td, r) {
    const bad = phaseMismatch(r);
    td.classList.toggle("is-mismatch", bad);
    if (bad) {
      const role = roleFor(r.staffCode, r.customerCode, monthOf(r.date));
      td.setAttribute("title", `担当役割（${phaseName(role)}）と工程（${phaseName(r.phaseCode)}）が一致しません`);
    } else {
      td.removeAttribute("title");
    }
  }
  function renderPhaseCell(tr, r) {
    const td = tr.querySelector(".col-phase");
    if (!td) return;
    td.innerHTML = phaseSelect(r.phaseCode, r.taskCode);
    applyPhaseMismatch(td, r);
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

    // 工数: スタッフ・日付変更時、顧客プルダウンをその行スタッフ・作業月の担当上位に再構築（選択値は保持）
    if (kind === "work" && (field === "staffCode" || field === "date")) {
      const td = tr.querySelector(".col-customer");
      if (td) td.innerHTML = customerSelect(row.customerCode, row.staffCode, monthOf(row.date));
    }
    // 工数: 業務区分(名)変更 → 業務コードを同期（工程判定はコード基準のため）
    if (kind === "work" && field === "taskType") {
      const code = nameToCode(value);
      if (code) {
        row.taskCode = code;
        const ci = tr.querySelector('[data-f="taskCode"]');
        if (ci) ci.value = code;
      }
    }
    // 工数: 業務コード変更 → 業務区分(名)を同期
    if (kind === "work" && field === "taskCode") {
      const nm = codeToName(value);
      if (nm) {
        row.taskType = nm;
        const ts = tr.querySelector('[data-f="taskType"]');
        if (ts) ts.value = nm;
      }
    }
    // 工数: 工程の有効選択肢・不一致警告を関連項目の変更に追従させる（日付＝作業月の担当変化も反映）
    if (kind === "work" && (field === "staffCode" || field === "customerCode" || field === "taskCode" || field === "taskType" || field === "date")) {
      renderPhaseCell(tr, row);
    } else if (kind === "work" && field === "phaseCode") {
      const td = tr.querySelector(".col-phase");
      if (td) applyPhaseMismatch(td, row);
    }

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
    const r = normBill({ invoiceId: makeInvoiceId(), billingMonth: currentMonth() });
    state.bill.unshift(r);
    newBill.add(r.invoiceId);
    dirtyBill.add(r.invoiceId);
    renderBill();
    updateDirtyInfo();
    showToast("請求行を追加しました（保存で確定）");
  }

  async function saveAll() {
    const billToSave = [];
    for (const id of dirtyBill) {
      const r = findRow("bill", id);
      if (!r) continue;
      if (!r.billingMonth || !Number.isFinite(Number(r.netAmount))) {
        showToast("請求：請求月と税抜金額を確認してください");
        return;
      }
      billToSave.push({
        invoiceId: r.invoiceId,
        billingMonth: r.billingMonth,
        customerCode: r.customerCode,
        customer: r.customerCode ? masterName("customers", r.customerCode) : "",
        invoiceItem: r.invoiceItem || "",
        invoiceItemCode: r.invoiceItemCode || "",
        transferDate: r.transferDate || "",
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

    if (billToSave.length === 0) {
      showToast("保存する変更がありません");
      return;
    }

    el.saveAll.disabled = true;
    try {
      if (billToSave.length) await window.WorklogBackend.saveBillings(billToSave);
    } catch (error) {
      showToast(error.message);
      el.saveAll.disabled = false;
      return;
    }
    el.saveAll.disabled = false;

    // ローカル状態を保存値で更新（名称解決済みの値を反映）
    billToSave.forEach((b) => {
      const idx = state.bill.findIndex((x) => x.invoiceId === b.invoiceId);
      if (idx >= 0) state.bill[idx] = normBill(b); else state.bill.push(normBill(b));
    });

    clearDirty();
    persistLocal();
    renderAll();
    showToast(`保存しました（請求${billToSave.length}件）`);
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

  // ===== CSV取込（かつ・かいしゅう 口座振替CSV・Shift-JIS・20列固定） =====
  // 列: [0]振替日 [6]関与先コード [7]関与先名 [8]内訳=業務コード [9]報酬額 [10]源泉税額
  const CSV_COL = { transfer: 0, custCode: 6, custName: 7, itemCode: 8, amount: 9 };

  function onCsvFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = ""; // 同一ファイルの連続選択を可能に
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = new TextDecoder("shift_jis").decode(new Uint8Array(reader.result));
        const draft = buildCsvDraft(text);
        if (!draft) return;
        csvDraft = draft;
        openCsvModal(draft);
      } catch (error) {
        showToast("CSV解析に失敗しました: " + error.message);
      }
    };
    reader.onerror = () => showToast("ファイル読込に失敗しました");
    reader.readAsArrayBuffer(file);
  }

  // 引用符対応のCSVパーサ（app.js parseCsv 相当。Shift-JISデコード済み文字列を渡す）
  function parseCsvText(text) {
    const rows = []; let row = []; let cell = ""; let quoted = false;
    const s = String(text).replace(/^﻿/, "");
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i], nx = s[i + 1];
      if (quoted) {
        if (ch === '"' && nx === '"') { cell += '"'; i += 1; }
        else if (ch === '"') { quoted = false; }
        else { cell += ch; }
      } else if (ch === '"') { quoted = true; }
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
      else { cell += ch; }
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim()));
  }

  function normTransferDate(v) {
    const m = String(v || "").trim().match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
    return m ? `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}` : "";
  }
  // 振替月 − 1 ＝ 請求月（YYYY-MM）
  function transferToBillingMonth(iso) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})/);
    if (!m) return "";
    let y = Number(m[1]), mo = Number(m[2]) - 1;
    if (mo <= 0) { mo += 12; y -= 1; }
    return `${y}-${String(mo).padStart(2, "0")}`;
  }
  function csvNum(v) { const n = Number(String(v == null ? "" : v).replace(/[,\s]/g, "")); return Number.isFinite(n) ? n : 0; }
  function fmtYen(n) { return Number(n || 0).toLocaleString("ja-JP"); }

  function buildCsvDraft(text) {
    const rows = parseCsvText(text);
    if (rows.length < 2) { showToast("CSVにデータ行がありません"); return null; }
    // 先頭がヘッダー行（[0]が日付でない）ならスキップ
    let dataRows = rows;
    if (!/^\d{4}\D\d/.test(String((rows[0] || [])[CSV_COL.transfer] || ""))) dataRows = rows.slice(1);
    if (dataRows.some((r) => r.length < 11)) { showToast("想定外の列構成です（20列のかつ・かいしゅうCSVを指定してください）"); return null; }

    // 振替日の単一性（1ファイル＝1請求月）
    const transfers = Array.from(new Set(dataRows.map((r) => normTransferDate(r[CSV_COL.transfer])).filter(Boolean)));
    if (transfers.length === 0) { showToast("振替日を読み取れませんでした"); return null; }
    if (transfers.length > 1) { showToast("振替日が複数あります（1ファイル＝1請求月）。ファイルを分けてください"); return null; }
    const transferDate = transfers[0];
    const billingMonth = transferToBillingMonth(transferDate);

    const items = [];
    let skipped = 0;
    const unknownCodes = new Set();
    const unknownCusts = new Map();
    dataRows.forEach((r) => {
      const amount = csvNum(r[CSV_COL.amount]);
      if (amount === 0) { skipped += 1; return; } // ¥0行（コード000等）はスキップ
      const code = normCode(r[CSV_COL.itemCode]);
      const custCode = String(r[CSV_COL.custCode] || "").trim();
      const custName = String(r[CSV_COL.custName] || "").trim();
      const task = state.tasks.find((t) => t.code === code);
      const type = task ? task.allocationType : "unknown";
      if (!task) unknownCodes.add(code);
      if (custCode && !state.customers.some((c) => c.code === custCode)) unknownCusts.set(custCode, custName);
      items.push({ code, amount, custCode, custName, type, taskName: task ? task.name : "" });
    });
    if (!items.length) { showToast("取り込める行がありませんでした（全行¥0など）"); return null; }

    return {
      transferDate, billingMonth, items, skipped,
      unknownCodes: Array.from(unknownCodes).sort(),
      unknownCusts: Array.from(unknownCusts.entries())
    };
  }

  // 決定論ID（b_請求月_顧客_内訳）で billing 行を生成。再取込は upsert 上書き＝重複なし。
  // 080消費税は独立行・netAmount＝税額（既存デモ/allocation.js 踏襲）。
  function csvBillingRows(draft, month) {
    return draft.items.map((it) => ({
      invoiceId: `b_${month}_${it.custCode}_${it.code}`,
      billingMonth: month,
      customerCode: it.custCode,
      customer: it.custName || masterName("customers", it.custCode),
      invoiceItem: it.taskName || it.code,
      invoiceItemCode: it.code,
      transferDate: draft.transferDate,
      paymentMethod: "口座振替",
      netAmount: it.amount,
      taxAmount: 0,
      grossAmount: it.amount,
      issuedDate: "",
      paymentDueDate: "",
      paymentStatus: "",
      memo: ""
    }));
  }

  function openCsvModal(draft) {
    el.csvTransfer.textContent = draft.transferDate || "—";
    el.csvMonth.value = draft.billingMonth;
    renderCsvPreview(draft);
    el.csvModal.hidden = false;
  }
  function closeCsvModal() { el.csvModal.hidden = true; csvDraft = null; }
  function onCsvMonthChange() { if (csvDraft) renderCsvPreview(csvDraft); }

  function renderCsvPreview(draft) {
    const month = el.csvMonth.value || draft.billingMonth;
    let service = 0, excluded = 0, tax = 0, unknownAmt = 0;
    const custSet = new Set();
    draft.items.forEach((it) => {
      custSet.add(it.custCode);
      const t = it.code === "080" ? "tax" : it.type;
      if (t === "tax") tax += it.amount;
      else if (t === "excluded") excluded += it.amount;
      else if (t === "unknown") unknownAmt += it.amount;
      else service += it.amount;
    });
    const taxable = service + excluded + unknownAmt; // 税抜（080除く）
    el.csvSummary.innerHTML = `<div class="csv-sum-grid">
      <div><span>請求月</span><b>${esc(month)}</b></div>
      <div><span>顧客数</span><b>${custSet.size}</b></div>
      <div><span>取込行</span><b>${draft.items.length}</b></div>
      <div><span>スキップ(¥0)</span><b>${draft.skipped}</b></div>
      <div><span>役務</span><b>¥${fmtYen(service)}</b></div>
      <div><span>配賦対象外</span><b>¥${fmtYen(excluded)}</b></div>
      ${unknownAmt ? `<div class="is-warn"><span>未マッチ</span><b>¥${fmtYen(unknownAmt)}</b></div>` : ""}
      <div><span>消費税(080)</span><b>¥${fmtYen(tax)}</b></div>
      <div class="csv-sum-total"><span>税抜計</span><b>¥${fmtYen(taxable)}</b></div>
      <div class="csv-sum-total"><span>税込計</span><b>¥${fmtYen(taxable + tax)}</b></div>
    </div>`;

    const warns = [];
    if (draft.unknownCodes.length) warns.push(`マッチング漏れ業務コード: ${draft.unknownCodes.join(", ")}（業務区分マスタに未登録）`);
    if (draft.unknownCusts.length) warns.push(`顧客マスタ未登録: ${draft.unknownCusts.map((e) => `${e[0]} ${e[1]}`).join(" / ")}`);
    if (warns.length) { el.csvWarn.hidden = false; el.csvWarn.innerHTML = warns.map((w) => `<div>⚠ ${esc(w)}</div>`).join(""); }
    else { el.csvWarn.hidden = true; el.csvWarn.innerHTML = ""; }

    const typeLabel = { service: "役務", excluded: "対象外", tax: "税", unknown: "未マッチ" };
    const max = 200;
    const body = draft.items.slice(0, max).map((it) => {
      const t = it.code === "080" ? "tax" : it.type;
      return `<tr class="${t === "unknown" ? "is-warn" : ""}">
        <td>${esc(it.custCode)} ${esc(it.custName)}</td>
        <td>${esc(it.code)} ${esc(it.taskName)}</td>
        <td class="num">¥${fmtYen(it.amount)}</td>
        <td><span class="csv-tag tag-${t}">${typeLabel[t] || esc(t)}</span></td>
      </tr>`;
    }).join("");
    el.csvPreviewBody.innerHTML = body + (draft.items.length > max ? `<tr><td colspan="4" class="csv-more">ほか ${draft.items.length - max} 行</td></tr>` : "");
  }

  async function confirmCsvImport() {
    if (!csvDraft) return;
    const month = el.csvMonth.value || csvDraft.billingMonth;
    if (!/^\d{4}-\d{2}$/.test(month)) { showToast("請求月を確認してください"); return; }
    const rows = csvBillingRows(csvDraft, month);
    el.csvConfirm.disabled = true;
    try {
      await window.WorklogBackend.saveBillings(rows); // 未接続時は null（ローカルのみ更新）
    } catch (error) {
      showToast(error.message); el.csvConfirm.disabled = false; return;
    }
    el.csvConfirm.disabled = false;
    rows.forEach((b) => {
      const idx = state.bill.findIndex((x) => x.invoiceId === b.invoiceId);
      if (idx >= 0) state.bill[idx] = normBill(b); else state.bill.push(normBill(b));
    });
    persistLocal();
    closeCsvModal();
    el.bFrom.value = month; el.bTo.value = month; // 取込月で絞り込み表示
    renderBill();
    updateDirtyInfo();
    showToast(`取り込みました（${rows.length}件・${month}）`);
  }

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

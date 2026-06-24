(function () {
  "use strict";

  // 工数入力（月間）: スタッフ1名×1か月を、行=顧客×業務×工程／列=日 のマトリクスで俯瞰入力する。
  // 1セル＝（日・顧客・業務・工程）の1明細（案A）。同一キーに既存明細が複数あるセルは
  // 読み取り専用＋「複」マークで保護し、編集は data-edit.html へ誘導する（データ無損失）。

  const INTERNAL = "__internal__";
  const PERSIST_KEY = "sharoshiWorklogMvp.monthGrid.v1"; // ローカルモード用ミラー

  const state = {
    staff: [], customers: [], taskTypes: [], tasks: [],
    taskPhases: [], customerStaff: [], entries: []
  };

  let staffCode = "";
  let month = "";                 // YYYY-MM
  const extraRows = new Map();     // rowKey -> rowMeta（手動追加・当月に明細がまだ無い行）
  const pending = new Map();       // cellId(rowKey|date) -> { action:'upsert'|'delete', entry }
  let cellModel = new Map();       // cellId -> { hours, editable, ids:[], multi }
  let displayRows = [];            // 描画順の行メタ
  let days = [];                   // [{ day, date, dow, weekend }]
  let memoTarget = null;           // メモ編集ポップオーバーの対象 { key, date, id }
  let paramStaff = "";             // URL誘導（スマホ画面から戻る等）で指定されたスタッフ

  const el = {};
  init();

  function init() {
    cache();
    // スマホ画面からの復帰など、URLパラメータで対象月・スタッフを復元
    const q = new URLSearchParams(location.search);
    paramStaff = q.get("staff") || "";
    const mp = q.get("month");
    month = (mp && /^\d{4}-\d{2}$/.test(mp)) ? mp : defaultMonth();
    el.monthInput.value = month;
    bind();
    hydrate();
  }

  function cache() {
    const ids = [
      "staffSelect", "monthInput", "prevMonth", "nextMonth", "saveAll", "copyPrev",
      "grandTotal", "pendingInfo", "gridWrap", "addCustomer", "addTask",
      "addPhaseField", "addPhase", "addRowBtn", "toast", "statusNote",
      "memoPopover", "memoHeader", "memoHours", "memoText", "memoHint", "memoMulti", "memoApply", "memoClear", "memoMobile", "memoClose"
    ];
    ids.forEach((id) => { el[id] = document.getElementById(id); });
  }

  function bind() {
    el.staffSelect.addEventListener("change", () => {
      if (!guardPending()) { el.staffSelect.value = staffCode; return; }
      staffCode = el.staffSelect.value;
      try { localStorage.setItem("sharoshiWorklogMvp.selectedStaff", staffCode); } catch (e) {}
      pending.clear();
      render();
    });
    el.monthInput.addEventListener("change", () => {
      if (!/^\d{4}-\d{2}$/.test(el.monthInput.value)) { el.monthInput.value = month; return; }
      if (!guardPending()) { el.monthInput.value = month; return; }
      month = el.monthInput.value;
      pending.clear();
      render();
    });
    el.prevMonth.addEventListener("click", () => stepMonth(-1));
    el.nextMonth.addEventListener("click", () => stepMonth(1));
    el.saveAll.addEventListener("click", saveAll);
    el.copyPrev.addEventListener("click", copyPreviousStructure);
    el.addRowBtn.addEventListener("click", addRowFromPicker);
    el.addCustomer.addEventListener("change", syncAddPicker);
    el.addTask.addEventListener("change", syncAddPicker);
    // セルは表示専用。単一クリック（または Enter/Space）で編集ウィンドウを開く。スクロールで閉じる。
    el.gridWrap.addEventListener("click", onCellActivate);
    el.gridWrap.addEventListener("keydown", onGridKeydown);
    el.gridWrap.addEventListener("scroll", closeMemo);
    el.memoApply.addEventListener("click", applyMemo);
    el.memoClear.addEventListener("click", clearMemo);
    el.memoMobile.addEventListener("click", openMobileEdit);
    el.memoClose.addEventListener("click", closeMemo);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMemo(); });
    document.addEventListener("mousedown", onDocMouseDown);
  }

  // ポップオーバー外（かつセル以外）をクリックしたら閉じる
  function onDocMouseDown(event) {
    if (el.memoPopover.hidden) return;
    if (el.memoPopover.contains(event.target)) return;
    if (event.target.closest && event.target.closest("td.cell-disp")) return;
    closeMemo();
  }

  function stepMonth(delta) {
    if (!guardPending()) return;
    month = addMonth(month, delta);
    el.monthInput.value = month;
    pending.clear();
    render();
  }

  function guardPending() {
    if (pending.size === 0) return true;
    return window.confirm("未保存の変更があります。破棄して切り替えますか？");
  }

  // ---- データ取得 ----
  async function hydrate() {
    setStatus("読み込み中…");
    if (window.WorklogBackend && window.WorklogBackend.isRemote()) {
      try {
        const remote = await window.WorklogBackend.loadState();
        if (remote) applyRemote(remote);
      } catch (error) {
        setStatus("");
        showToast("読み込みに失敗しました: " + error.message);
        return;
      }
    } else {
      loadLocal();
      setStatus("ローカルモード（config.js が未設定）。保存はこの端末内のみ。");
    }
    fillStaffSelect();
    const saved = (() => { try { return localStorage.getItem("sharoshiWorklogMvp.selectedStaff"); } catch (e) { return ""; } })();
    if (paramStaff && state.staff.some((s) => s.code === paramStaff)) staffCode = paramStaff;
    else if (saved && state.staff.some((s) => s.code === saved)) staffCode = saved;
    else if (!staffCode && state.staff.length) staffCode = state.staff[0].code;
    el.staffSelect.value = staffCode;
    fillAddCustomer();
    fillAddTask();
    if (window.WorklogBackend && window.WorklogBackend.isRemote()) setStatus("");
    render();
  }

  function applyRemote(remote) {
    state.staff = normMaster(remote.staff, "S");
    state.customers = normMaster(remote.customers, "C");
    state.taskTypes = Array.isArray(remote.taskTypes) ? remote.taskTypes : [];
    state.tasks = Array.isArray(remote.tasks)
      ? remote.tasks.map((t) => ({ code: String(t.code), name: String(t.name || ""), allocationType: t.allocationType || "service" })).filter((t) => t.code)
      : [];
    state.taskPhases = Array.isArray(remote.taskPhases)
      ? remote.taskPhases.map((p) => ({ taskCode: String(p.taskCode), phaseCode: String(p.phaseCode), phaseName: p.phaseName, ratio: Number(p.ratio || 0), sortOrder: Number(p.sortOrder || 0) }))
      : [];
    state.customerStaff = Array.isArray(remote.customerStaff)
      ? remote.customerStaff.map((c) => ({ customerCode: String(c.customerCode), staffCode: String(c.staffCode || ""), role: String(c.role || ""), effectiveFrom: String(c.effectiveFrom || "") }))
      : [];
    state.entries = normEntries(remote.entries);
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      state.staff = normMaster(p.staff, "S");
      state.customers = normMaster(p.customers, "C");
      state.taskTypes = Array.isArray(p.taskTypes) ? p.taskTypes : [];
      state.tasks = Array.isArray(p.tasks) ? p.tasks : [];
      state.taskPhases = Array.isArray(p.taskPhases) ? p.taskPhases : [];
      state.customerStaff = Array.isArray(p.customerStaff) ? p.customerStaff : [];
      state.entries = normEntries(p.entries);
    } catch (e) { /* 破損時は空で続行 */ }
  }

  function persistLocal() {
    if (window.WorklogBackend && window.WorklogBackend.isRemote()) return;
    try { localStorage.setItem(PERSIST_KEY, JSON.stringify(state)); } catch (e) {}
  }

  // ---- セレクト初期化 ----
  function fillStaffSelect() {
    el.staffSelect.innerHTML = state.staff.map((s) => `<option value="${esc(s.code)}">${esc(s.code)} ${esc(s.name)}</option>`).join("");
  }
  function fillAddTask() {
    const svc = serviceTasks().map((t) => ({ code: normCode(t.code), name: t.name }))
      .sort((a, b) => a.code.localeCompare(b.code, "ja"));
    el.addTask.innerHTML = svc.map((t) => `<option value="${esc(t.code)}">${esc(t.code)} ${esc(t.name)}</option>`).join("");
  }
  function fillAddCustomer() {
    const g = groupedCustomers(staffCode, month);
    const opt = (c, role) => `<option value="${esc(c.code)}">${esc(c.code)} ${esc(c.name)}${role ? ` (${role === "PRE" ? "Pre" : "Rev"})` : ""}</option>`;
    let html = `<option value="">顧客を選択…</option>`;
    if (g.pre.length || g.rev.length) {
      html += `<optgroup label="担当顧客">` + g.pre.map((c) => opt(c, "PRE")).join("") + g.rev.map((c) => opt(c, "REV")).join("") + `</optgroup>`;
    }
    if (g.other.length) html += `<optgroup label="その他">` + g.other.map((c) => opt(c, "")).join("") + `</optgroup>`;
    html += `<optgroup label="社内"><option value="${INTERNAL}">社内 / 非生産</option></optgroup>`;
    el.addCustomer.innerHTML = html;
    syncAddPicker();
  }

  // 行追加ピッカー: 顧客=社内なら業務/工程を隠す。業務が2工程なら工程選択を出し、担当役割を既定に。
  function syncAddPicker() {
    const cust = el.addCustomer.value;
    const internal = cust === INTERNAL;
    el.addTask.disabled = internal;
    if (internal) { el.addPhaseField.hidden = true; return; }
    const ph = phasesFor(el.addTask.value);
    if (ph.length >= 2) {
      el.addPhase.innerHTML = ph.map((p) => `<option value="${esc(p.phaseCode)}">${esc(p.phaseName || p.phaseCode)}</option>`).join("");
      const role = cust ? roleAsOf(cust, staffCode, month) : "";
      if (role && ph.some((p) => p.phaseCode === role)) el.addPhase.value = role;
      el.addPhaseField.hidden = false;
    } else {
      el.addPhaseField.hidden = true;
    }
  }

  function addRowFromPicker() {
    const cust = el.addCustomer.value;
    if (cust === INTERNAL) {
      addExtraRow("", "", "");
      return;
    }
    if (!cust) { showToast("顧客を選択してください"); return; }
    const taskCode = el.addTask.value;
    if (!taskCode) { showToast("業務を選択してください"); return; }
    const ph = phasesFor(taskCode);
    let phaseCode = "";
    if (ph.length >= 2) phaseCode = el.addPhase.value || ph[0].phaseCode;
    else if (ph.length === 1) phaseCode = ph[0].phaseCode;
    else phaseCode = "PRE";
    addExtraRow(cust, taskCode, phaseCode);
  }

  function addExtraRow(customerCode, taskCode, phaseCode) {
    const key = rowKey(customerCode, taskCode, phaseCode);
    if (currentRowKeys().has(key)) { showToast("その行は既にあります"); return; }
    extraRows.set(key, { customerCode, taskCode, phaseCode });
    render();
    showToast("行を追加しました");
  }

  function currentRowKeys() {
    const set = new Set(displayRows.map((r) => r.key));
    extraRows.forEach((_, k) => set.add(k));
    return set;
  }

  // ---- 月の明細から前月の行構成を取り込む（工数は空） ----
  function copyPreviousStructure() {
    const prev = addMonth(month, -1);
    const keys = new Set();
    entriesOf(staffCode, prev).forEach((e) => keys.add(rowKey(e.customerCode || "", e.taskCode || "", e.phaseCode || "")));
    let added = 0;
    keys.forEach((k) => {
      if (currentRowKeys().has(k)) return;
      const [c, t, p] = k.split("|");
      extraRows.set(k, { customerCode: c, taskCode: t, phaseCode: p });
      added += 1;
    });
    render();
    showToast(added ? `前月の${added}行を取り込みました` : "取り込む行はありません");
  }

  // ---- 描画 ----
  function render() {
    closeMemo();
    days = buildDays(month);
    displayRows = buildRows();
    cellModel = buildCellModel();
    el.gridWrap.innerHTML = buildGridHtml();
    refreshTotals();
    refreshPendingInfo();
    fillAddCustomer(); // スタッフ/対象月の変更に追従して「行を追加」の顧客候補（担当グルーピング）を再構築
  }

  function buildRows() {
    const metaByKey = new Map();
    // 当月に明細のある行
    entriesOf(staffCode, month).forEach((e) => {
      const k = rowKey(e.customerCode || "", e.taskCode || "", e.phaseCode || "");
      if (!metaByKey.has(k)) metaByKey.set(k, { customerCode: e.customerCode || "", taskCode: e.taskCode || "", phaseCode: e.phaseCode || "" });
    });
    // 手動追加行
    extraRows.forEach((meta, k) => { if (!metaByKey.has(k)) metaByKey.set(k, meta); });

    const rows = [];
    metaByKey.forEach((meta, k) => {
      const internal = !meta.customerCode && !meta.taskCode;
      const role = internal ? "" : roleAsOf(meta.customerCode, staffCode, month);
      const group = internal ? "internal" : (role ? "assigned" : "spot");
      rows.push({
        key: k,
        customerCode: meta.customerCode,
        customerName: internal ? "—" : (masterName("customers", meta.customerCode) || meta.customerCode),
        taskCode: meta.taskCode,
        taskName: internal ? "社内 / その他" : (taskName(meta.taskCode) || meta.taskCode || "—"),
        phaseCode: meta.phaseCode,
        phaseName: phaseName(meta.taskCode, meta.phaseCode),
        phaseSort: phaseSort(meta.taskCode, meta.phaseCode),
        group: group,
        role: role
      });
    });

    const groupOrder = { assigned: 0, spot: 1, internal: 2 };
    rows.sort((a, b) =>
      (groupOrder[a.group] - groupOrder[b.group])
      || String(a.customerCode).localeCompare(String(b.customerCode), "ja")
      || String(a.taskCode).localeCompare(String(b.taskCode), "ja")
      || (a.phaseSort - b.phaseSort)
    );
    return rows;
  }

  function buildCellModel() {
    const model = new Map();
    // 当月・該当スタッフの明細をセルキーで集約
    const byCell = new Map();
    entriesOf(staffCode, month).forEach((e) => {
      const id = cellId(rowKey(e.customerCode || "", e.taskCode || "", e.phaseCode || ""), e.date);
      if (!byCell.has(id)) byCell.set(id, []);
      byCell.get(id).push(e);
    });
    byCell.forEach((list, id) => {
      const hours = list.reduce((s, e) => s + num(e.hours), 0);
      const memo = list.length === 1 ? (list[0].memo || "") : list.map((e) => e.memo).filter(Boolean).join(" / ");
      model.set(id, { hours: round2(hours), memo: memo, editable: list.length <= 1, ids: list.map((e) => e.id), multi: list.length > 1 });
    });
    return model;
  }

  function buildGridHtml() {
    if (!staffCode) return `<p class="grid-empty">スタッフを選択してください。</p>`;
    const headDays = days.map((d) =>
      `<th class="col-day${d.weekend ? " weekend" : ""}" data-date="${d.date}"><span class="d-num">${d.day}</span><span class="d-dow">${dowLabel(d.dow)}</span></th>`
    ).join("");

    let body = "";
    let lastGroup = null;
    let lastCustomer = null;
    let band = 0;
    const groupLabel = { assigned: "担当顧客", spot: "スポット・その他", internal: "社内・非生産" };
    displayRows.forEach((r) => {
      if (r.group !== lastGroup) {
        body += `<tr class="group-row"><td class="col-cust group-cell" colspan="2">${esc(groupLabel[r.group])}</td>`
          + days.map((d) => `<td class="col-day${d.weekend ? " weekend" : ""}"></td>`).join("")
          + `<td class="col-total"></td></tr>`;
        lastGroup = r.group;
        lastCustomer = null;
      }
      // 顧客ブロックの可読性: 名称は先頭行のみ表示／境界に区切り線（cust-start）／顧客単位で淡い交互バンド（band）
      const custKey = r.group + "|" + r.customerCode;
      const isCustStart = custKey !== lastCustomer;
      if (isCustStart) { band ^= 1; lastCustomer = custKey; }
      const rowCls = ((isCustStart ? "cust-start" : "") + (band ? " band" : "")).trim();
      const custLabel = isCustStart ? esc(r.customerName) : "";
      const badge = r.phaseName ? ` <span class="phase-badge phase-${(r.phaseCode || "").toLowerCase()}">${esc(r.phaseName)}</span>` : "";
      const cells = days.map((d) => {
        const id = cellId(r.key, d.date);
        const cm = cellModel.get(id);
        const cls = "col-day cell-disp" + (d.weekend ? " weekend" : "");
        const aria = `${esc(r.customerName)} ${esc(r.taskName)} ${d.date}`;
        if (cm && cm.multi) {
          const mt = "複数明細（クリックで詳細・スマホ用画面で編集）" + (cm.memo ? " / " + cm.memo : "");
          return `<td class="${cls} cell-multi" data-row="${esc(r.key)}" data-date="${d.date}" tabindex="0" role="button" aria-label="${aria}（複数明細）" title="${esc(mt)}">${fmt(cm.hours)}<span class="multi-dot">複</span></td>`;
        }
        const v = cm && cm.hours ? fmt(cm.hours) : "";
        const hasMemo = !!(cm && cm.memo);
        return `<td class="${cls}${hasMemo ? " has-memo" : ""}" data-row="${esc(r.key)}" data-date="${d.date}" tabindex="0" role="button" aria-label="${aria}"${hasMemo ? ` title="${esc(cm.memo)}"` : ""}><span class="cell-val">${v}</span>${hasMemo ? `<span class="cell-memo-dot" aria-hidden="true"></span>` : ""}</td>`;
      }).join("");
      body += `<tr data-row="${esc(r.key)}"${rowCls ? ` class="${rowCls}"` : ""}>`
        + `<td class="col-cust" title="${esc(r.customerName)}">${custLabel}</td>`
        + `<td class="col-task" title="${esc(r.taskName)}">${esc(r.taskName)}${badge}</td>`
        + cells
        + `<td class="col-total" data-rowtotal="${esc(r.key)}">0</td></tr>`;
    });
    if (!displayRows.length) {
      body = `<tr><td class="col-cust"></td><td class="col-task"></td>`
        + days.map((d) => `<td class="col-day${d.weekend ? " weekend" : ""}"></td>`).join("")
        + `<td class="col-total"></td></tr>`;
    }

    const footDays = days.map((d) => `<td class="col-day${d.weekend ? " weekend" : ""}" data-daytotal="${d.date}">0</td>`).join("");
    return `<table class="month-grid">
      <thead><tr>
        <th class="col-cust">顧客</th><th class="col-task">業務 / 工程</th>${headDays}<th class="col-total">月計</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr class="foot-row"><td class="col-cust" colspan="2">日計</td>${footDays}<td class="col-total" data-grandtotal>0</td></tr></tfoot>
    </table>`;
  }

  // ---- 集計・保留 ----
  function computePending(key, date, id, cm) {
    const original = originalCell(id);
    const sameHours = round2(cm.hours) === round2(original.hours);
    const sameMemo = (cm.memo || "") === (original.memo || "");
    if (sameHours && sameMemo) { pending.delete(id); return; }
    const row = displayRows.find((r) => r.key === key);
    if (cm.hours > 0) {
      if (original.ids.length === 1) {
        const base = state.entries.find((e) => e.id === original.ids[0]);
        const entry = Object.assign({}, base, { hours: round2(cm.hours), memo: cm.memo || "", updatedAt: new Date().toISOString() });
        pending.set(id, { action: "upsert", entry });
      } else {
        pending.set(id, { action: "upsert", entry: newEntry(row, date, round2(cm.hours), cm.memo || "") });
      }
    } else {
      if (original.ids.length === 1) pending.set(id, { action: "delete", entry: { id: original.ids[0] } });
      else pending.delete(id);
    }
  }

  function originalCell(id) {
    let hours = 0;
    let memo = "";
    const ids = [];
    state.entries.forEach((e) => {
      const eid = cellId(rowKey(e.customerCode || "", e.taskCode || "", e.phaseCode || ""), e.date);
      if (eid === id && (e.staffCode || "") === staffCode) {
        hours += num(e.hours); ids.push(e.id);
        if (ids.length === 1) memo = e.memo || "";
      }
    });
    return { hours: round2(hours), ids, memo };
  }

  function refreshTotals() {
    const table = el.gridWrap.querySelector(".month-grid");
    if (!table) return;
    const dayTotals = {};
    days.forEach((d) => { dayTotals[d.date] = 0; });
    let grand = 0;
    displayRows.forEach((r) => {
      let rowTotal = 0;
      days.forEach((d) => {
        const cm = cellModel.get(cellId(r.key, d.date));
        const h = cm ? num(cm.hours) : 0;
        rowTotal += h;
        dayTotals[d.date] += h;
      });
      grand += rowTotal;
      const cell = table.querySelector(`[data-rowtotal="${cssEsc(r.key)}"]`);
      if (cell) cell.textContent = fmt(rowTotal);
    });
    days.forEach((d) => {
      const cell = table.querySelector(`[data-daytotal="${d.date}"]`);
      if (!cell) return;
      cell.textContent = fmt(dayTotals[d.date]);
      cell.classList.toggle("zero-warn", !d.weekend && dayTotals[d.date] === 0);
    });
    const gt = table.querySelector("[data-grandtotal]");
    if (gt) gt.textContent = fmt(grand);
    el.grandTotal.textContent = fmt(grand) + "h";
  }

  function refreshPendingInfo() {
    const n = pending.size;
    el.pendingInfo.textContent = n ? `未保存 ${n} 件` : "";
    el.saveAll.disabled = n === 0;
  }

  // ---- 保存 ----
  async function saveAll() {
    if (pending.size === 0) { showToast("変更はありません"); return; }
    const upserts = [];
    const deletes = [];
    pending.forEach((p) => { if (p.action === "upsert") upserts.push(p.entry); else deletes.push(p.entry.id); });
    el.saveAll.disabled = true;
    setStatus("保存中…");
    try {
      if (window.WorklogBackend && window.WorklogBackend.isRemote()) {
        if (upserts.length) await window.WorklogBackend.saveEntries(upserts);
        for (const id of deletes) await window.WorklogBackend.deleteEntry(id);
      }
    } catch (error) {
      setStatus("");
      el.saveAll.disabled = false;
      showToast("保存に失敗しました: " + error.message);
      return;
    }
    // ローカル state へ反映（リモート成功後・楽観反映）
    deletes.forEach((id) => { state.entries = state.entries.filter((e) => e.id !== id); });
    upserts.forEach((entry) => {
      const i = state.entries.findIndex((e) => e.id === entry.id);
      if (i >= 0) state.entries[i] = entry; else state.entries.push(entry);
    });
    persistLocal();
    pending.clear();
    // 保存済みの行は extraRows から外す必要はない（再描画で明細ありとして残る）
    setStatus(window.WorklogBackend && window.WorklogBackend.isRemote() ? "" : "ローカルモード（この端末内のみ）。");
    render();
    showToast(`保存しました（更新${upserts.length}・削除${deletes.length}）`);
  }

  function newEntry(row, date, hours, memo) {
    const internal = !row.customerCode && !row.taskCode;
    return {
      id: makeId(),
      date: date,
      staffCode: staffCode,
      staff: masterName("staff", staffCode),
      customerCode: internal ? "" : row.customerCode,
      customer: internal ? "" : (masterName("customers", row.customerCode) || ""),
      taskType: internal ? "社内/その他" : (taskName(row.taskCode) || row.taskCode),
      taskCode: internal ? "" : row.taskCode,
      phaseCode: internal ? "" : (row.phaseCode || ""),
      hours: hours,
      memo: memo || "",
      updatedAt: new Date().toISOString()
    };
  }

  // ---- 工数・メモ編集ポップオーバー ----
  // セルは表示専用。クリック／Enter・Space で編集ウィンドウを開く（単一=編集／複数明細=読取専用＋スマホ誘導）。
  function onCellActivate(event) {
    const td = event.target.closest("td.cell-disp");
    if (!td || !td.dataset.row) return;
    openMemo(td.dataset.row, td.dataset.date);
  }

  function onGridKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const td = event.target.closest ? event.target.closest("td.cell-disp") : null;
    if (!td || !td.dataset.row) return;
    event.preventDefault();
    openMemo(td.dataset.row, td.dataset.date);
  }

  function openMemo(key, date) {
    const id = cellId(key, date);
    const cm = cellModel.get(id) || { hours: 0, memo: "", editable: true, ids: [], multi: false };
    const row = displayRows.find((r) => r.key === key);
    if (!row) return;
    memoTarget = { key, date, id };
    const phase = row.phaseName ? `　${row.phaseName}` : "";
    el.memoHeader.textContent = `${mmdd(date)}　${row.customerName} / ${row.taskName}${phase}`;
    el.memoHours.value = cm.hours ? String(cm.hours) : "";
    el.memoText.value = cm.memo || "";
    // 複数明細セルは読取専用＋「スマホ用画面で編集」、単一/空セルは通常編集
    const multi = !!cm.multi;
    el.memoHours.disabled = multi;
    el.memoText.readOnly = multi;
    el.memoApply.hidden = multi;
    el.memoClear.hidden = multi;
    el.memoHint.hidden = multi;
    el.memoMobile.hidden = !multi;
    el.memoMulti.hidden = !multi;
    el.memoPopover.classList.toggle("is-readonly", multi);
    const td = cellTd(key, date);
    el.memoPopover.hidden = false;
    positionPopover(td);
    if (multi) el.memoMobile.focus(); else el.memoText.focus();
  }

  // 複数明細セル → スマホ用作業登録画面を当該日付・スタッフ・顧客/業務/工程プリセットで開く（戻る導線つき）
  function openMobileEdit() {
    if (!memoTarget) return;
    if (!guardPending()) return; // 未保存の編集がある場合は確認（移動で破棄されるため）
    const row = displayRows.find((r) => r.key === memoTarget.key);
    if (!row) return;
    const p = new URLSearchParams();
    p.set("from", "worklog-month");
    p.set("date", memoTarget.date);
    p.set("month", month);
    if (staffCode) p.set("staff", staffCode);
    if (row.customerCode) p.set("customer", row.customerCode);
    if (row.taskCode) p.set("task", row.taskCode);
    if (row.phaseCode) p.set("phase", row.phaseCode);
    window.location.href = "staff.html?" + p.toString();
  }

  function positionPopover(td) {
    const pop = el.memoPopover;
    const pw = pop.offsetWidth || 300;
    const ph = pop.offsetHeight || 200;
    const r = td ? td.getBoundingClientRect() : { left: 120, right: 160, top: 140, bottom: 170 };
    let left = r.left;
    if (left + pw > window.innerWidth - 12) left = window.innerWidth - 12 - pw;
    if (left < 12) left = 12;
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - 12) top = Math.max(12, r.top - ph - 6);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  function applyMemo() {
    if (!memoTarget) return;
    let h = Number(el.memoHours.value);
    if (!Number.isFinite(h) || h < 0) h = 0;
    if (h > 24) h = 24;
    const memo = el.memoText.value.trim(); // 前後の空白・改行のみ除去、内部の改行は保持
    const { key, date, id } = memoTarget;
    const cm = cellModel.get(id) || { hours: 0, memo: "", editable: true, ids: [], multi: false };
    cm.hours = round2(h);
    cm.memo = memo;
    cellModel.set(id, cm);
    computePending(key, date, id, cm);
    updateCellDom(key, date, cm);
    refreshTotals();
    refreshPendingInfo();
    closeMemo();
    showToast("反映しました（保存で確定）");
  }

  function clearMemo() {
    el.memoHours.value = "";
    el.memoText.value = "";
    applyMemo();
  }

  function closeMemo() {
    if (el.memoPopover) el.memoPopover.hidden = true;
    memoTarget = null;
  }

  function updateCellDom(key, date, cm) {
    const td = cellTd(key, date);
    if (!td) return;
    let val = td.querySelector(".cell-val");
    if (!val) { val = document.createElement("span"); val.className = "cell-val"; td.insertBefore(val, td.firstChild); }
    val.textContent = cm.hours ? fmt(cm.hours) : "";
    const hasMemo = !!cm.memo;
    td.classList.toggle("has-memo", hasMemo);
    if (hasMemo) td.setAttribute("title", cm.memo); else td.removeAttribute("title");
    let dot = td.querySelector(".cell-memo-dot");
    if (hasMemo && !dot) { dot = document.createElement("span"); dot.className = "cell-memo-dot"; dot.setAttribute("aria-hidden", "true"); td.appendChild(dot); }
    if (!hasMemo && dot) dot.remove();
  }

  function cellTd(key, date) { return el.gridWrap.querySelector(`td.cell-disp[data-row="${cssEsc(key)}"][data-date="${date}"]`); }
  function mmdd(date) { const p = String(date).split("-"); return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}` : date; }

  // ---- 配賦エンジン委譲（顧客担当の時系列解決） ----
  function roleAsOf(customerCode, sCode, m) {
    if (!customerCode || !sCode) return "";
    return window.JOfficeAllocation ? window.JOfficeAllocation.roleAsOf(state.customerStaff || [], customerCode, sCode, m || "") : "";
  }
  function groupedCustomers(sCode, m) {
    const roleMap = window.JOfficeAllocation
      ? window.JOfficeAllocation.resolveAssignees(state.customerStaff || [], m || "").roleByCustomerStaff
      : new Map();
    const pre = [], rev = [], other = [];
    (state.customers || []).forEach((c) => {
      const role = (roleMap.get(String(c.code)) || {})[String(sCode)] || "";
      if (role === "PRE") pre.push(c);
      else if (role === "REV") rev.push(c);
      else other.push(c);
    });
    const byCode = (a, b) => String(a.code).localeCompare(String(b.code), "ja");
    return { pre: pre.sort(byCode), rev: rev.sort(byCode), other: other.sort(byCode) };
  }

  // ---- ヘルパ ----
  function entriesOf(sCode, m) {
    return (state.entries || []).filter((e) => (e.staffCode || "") === sCode && String(e.date || "").slice(0, 7) === m);
  }
  function rowKey(c, t, p) { return `${c || ""}|${t || ""}|${p || ""}`; }
  function cellId(key, date) { return `${key}@${date}`; }
  function normCode(v) { const s = String(v == null ? "" : v).trim(); return /^\d+$/.test(s) ? s.padStart(3, "0") : s; }
  function serviceTasks() { return (state.tasks || []).filter((t) => t.allocationType === "service"); }
  function phasesFor(code) { const c = normCode(code); return (state.taskPhases || []).filter((p) => normCode(p.taskCode) === c && Number(p.ratio) > 0).sort((a, b) => a.sortOrder - b.sortOrder); }
  function taskName(code) { const c = normCode(code); const t = (state.tasks || []).find((x) => normCode(x.code) === c); return t ? t.name : code; }
  function phaseName(taskCode, phaseCode) { if (!phaseCode) return ""; const p = phasesFor(taskCode).find((x) => x.phaseCode === phaseCode); return p ? (p.phaseName || p.phaseCode) : phaseLabel(phaseCode); }
  function phaseSort(taskCode, phaseCode) { const p = phasesFor(taskCode).find((x) => x.phaseCode === phaseCode); return p ? Number(p.sortOrder || 0) : 0; }
  function phaseLabel(code) { if (code === "PRE") return "Prepare"; if (code === "REV") return "Review"; return code; }
  function masterName(type, code) { return ((state[type] || []).find((x) => x.code === code) || {}).name || ""; }

  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  function round2(v) { return Math.round(num(v) * 100) / 100; }
  function fmt(v) { const n = round2(v); return n === 0 ? "0" : (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "")); }

  function defaultMonth() {
    const latest = (state.entries || []).reduce((mx, e) => { const m = String(e.date || "").slice(0, 7); return m > mx ? m : mx; }, "");
    return latest || toMonth(new Date());
  }
  function toMonth(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
  function addMonth(m, delta) {
    const [y, mo] = m.split("-").map(Number);
    const d = new Date(y, (mo - 1) + delta, 1);
    return toMonth(d);
  }
  function buildDays(m) {
    const [y, mo] = m.split("-").map(Number);
    const last = new Date(y, mo, 0).getDate();
    const arr = [];
    for (let day = 1; day <= last; day += 1) {
      const dt = new Date(y, mo - 1, day);
      const dow = dt.getDay();
      arr.push({ day, date: `${m}-${String(day).padStart(2, "0")}`, dow, weekend: dow === 0 || dow === 6 });
    }
    return arr;
  }
  function dowLabel(dow) { return ["日", "月", "火", "水", "木", "金", "土"][dow]; }

  function normMaster(items, prefix) {
    const src = Array.isArray(items) ? items : [];
    return src.map((item, i) => {
      if (typeof item === "string") return { code: `${prefix}${String(i + 1).padStart(3, "0")}`, name: item };
      return { code: String(item.code || "").trim(), name: String(item.name || "").trim() };
    }).filter((x) => x.code && x.name);
  }
  function normEntries(items) {
    if (!Array.isArray(items)) return [];
    return items.map((e) => ({
      id: e.id || makeId(),
      date: String(e.date || "").slice(0, 10),
      staffCode: String(e.staffCode || ""),
      staff: e.staff || "",
      customerCode: String(e.customerCode || ""),
      customer: e.customer || "",
      taskType: e.taskType || "",
      taskCode: e.taskCode == null ? "" : String(e.taskCode),
      phaseCode: e.phaseCode == null ? "" : String(e.phaseCode),
      hours: num(e.hours),
      memo: e.memo || "",
      updatedAt: e.updatedAt || ""
    }));
  }

  function makeId() { return `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function esc(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function cssEsc(v) { return String(v).replace(/["\\]/g, "\\$&"); }

  function setStatus(text) { if (el.statusNote) el.statusNote.textContent = text || ""; }
  let toastTimer = null;
  function showToast(message) {
    window.clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.classList.add("show");
    toastTimer = window.setTimeout(() => el.toast.classList.remove("show"), 2000);
  }
})();

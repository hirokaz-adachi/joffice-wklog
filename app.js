(function () {
  "use strict";

  const storageKey = "sharoshiWorklogMvp.v1";
  const INTERNAL_VALUE = "__internal__"; // 案2: 社内/非生産工数（顧客なし）
  const initialState = {
    staff: [],
    customers: [],
    taskTypes: ["顧問対応", "給与計算", "手続き", "労務相談", "助成金", "スポット", "社内/その他"],
    tasks: [],
    taskPhases: [],
    customerStaff: [],
    entries: []
  };

  const state = loadState();
  if (!Array.isArray(state.tasks)) state.tasks = [];
  if (!Array.isArray(state.taskPhases)) state.taskPhases = [];
  if (!Array.isArray(state.customerStaff)) state.customerStaff = [];
  let calendarCursor = new Date();
  const el = {
    form: document.getElementById("entryForm"),
    editingId: document.getElementById("editingId"),
    workDate: document.getElementById("workDate"),
    staff: document.getElementById("staff"),
    customer: document.getElementById("customer"),
    taskType: document.getElementById("taskType"),
    phase: document.getElementById("phase"),
    phaseField: document.getElementById("phaseField"),
    hours: document.getElementById("hours"),
    memo: document.getElementById("memo"),
    saveEntry: document.getElementById("saveEntry"),
    cancelEdit: document.getElementById("cancelEdit"),
    copyPrevious: document.getElementById("copyPrevious"),
    exportCsv: document.getElementById("exportCsv"),
    importCsv: document.getElementById("importCsv"),
    prevMonth: document.getElementById("prevMonth"),
    nextMonth: document.getElementById("nextMonth"),
    calendarTitle: document.getElementById("calendarTitle"),
    monthCalendar: document.getElementById("monthCalendar"),
    dailyHours: document.getElementById("dailyHours"),
    dailyCount: document.getElementById("dailyCount"),
    dailyCustomers: document.getElementById("dailyCustomers"),
    selectedDateLabel: document.getElementById("selectedDateLabel"),
    staffSummary: document.getElementById("staffSummary"),
    customerSummary: document.getElementById("customerSummary"),
    entryRows: document.getElementById("entryRows"),
    filterFrom: document.getElementById("filterFrom"),
    filterTo: document.getElementById("filterTo"),
    filterStaff: document.getElementById("filterStaff"),
    filterCustomer: document.getElementById("filterCustomer"),
    cardDayList: document.getElementById("cardDayList"),
    cardDayMeta: document.getElementById("cardDayMeta"),
    toast: document.getElementById("toast")
  };

  init();

  async function init() {
    const today = new Date();
    const todayValue = toDateInput(today);
    el.workDate.value = todayValue;
    el.filterFrom.value = todayValue;
    el.filterTo.value = todayValue;
    calendarCursor = new Date(today.getFullYear(), today.getMonth(), 1);

    bindEvents();
    await hydrateRemoteState();
    render();
  }

  async function hydrateRemoteState() {
    if (!window.WorklogBackend || !window.WorklogBackend.isRemote()) return;
    try {
      const remoteState = await window.WorklogBackend.loadState();
      if (!remoteState) return;
      const staff = normalizeMaster(remoteState.staff, "S");
      const customers = normalizeMaster(remoteState.customers, "C");
      state.staff = staff;
      state.customers = customers;
      state.taskTypes = Array.isArray(remoteState.taskTypes) && remoteState.taskTypes.length ? remoteState.taskTypes : initialState.taskTypes;
      state.tasks = Array.isArray(remoteState.tasks)
        ? remoteState.tasks.map((t) => ({ code: String(t.code), name: String(t.name || ""), allocationType: t.allocationType || "service" })).filter((t) => t.code)
        : [];
      state.taskPhases = Array.isArray(remoteState.taskPhases)
        ? remoteState.taskPhases.map((p) => ({ taskCode: String(p.taskCode), phaseCode: String(p.phaseCode), phaseName: p.phaseName, ratio: Number(p.ratio || 0), sortOrder: Number(p.sortOrder || 0) }))
        : [];
      state.customerStaff = Array.isArray(remoteState.customerStaff)
        ? remoteState.customerStaff.map((c) => ({ customerCode: String(c.customerCode), staffCode: String(c.staffCode), role: String(c.role || "") }))
        : [];
      state.entries = normalizeEntries(remoteState.entries, staff, customers);
      persist();
      showToast("スプレッドシートから読み込みました");
    } catch (error) {
      showToast(error.message);
    }
  }

  function bindEvents() {
    el.form.addEventListener("submit", saveEntry);
    el.cancelEdit.addEventListener("click", () => {
      resetForm({ keepDate: true, keepStaff: true });
      renderCardDayList();
    });
    el.workDate.addEventListener("change", () => {
      syncCalendarToSelectedDate();
      render();
    });
    el.prevMonth.addEventListener("click", () => shiftCalendarMonth(-1));
    el.nextMonth.addEventListener("click", () => shiftCalendarMonth(1));
    el.copyPrevious.addEventListener("click", copyPreviousDay);
    el.exportCsv.addEventListener("click", exportCsv);
    el.importCsv.addEventListener("change", importCsv);

    el.staff.addEventListener("change", () => { renderCardDayList(); syncCustomerForTask(); });
    el.customer.addEventListener("change", syncCustomerForTask);
    el.taskType.addEventListener("change", syncCustomerForTask);

    [el.filterFrom, el.filterTo, el.filterStaff, el.filterCustomer].forEach((input) => {
      input.addEventListener("input", renderEntries);
    });
  }

  async function saveEntry(event) {
    event.preventDefault();
    const hours = Number(el.hours.value);
    const taskValue = el.taskType.value;
    const internal = taskValue === INTERNAL_VALUE || !taskValue || taskValue === "社内/その他";
    const taskCode = internal ? "" : taskValue;
    const phaseCode = internal ? "" : currentPhaseCode(taskCode);
    const entry = {
      id: el.editingId.value || makeId(),
      date: el.workDate.value,
      staffCode: el.staff.value,
      staff: getMasterName("staff", el.staff.value),
      customerCode: internal ? "" : el.customer.value,
      customer: internal ? "" : (el.customer.value ? getMasterName("customers", el.customer.value) : ""),
      taskType: internal ? "社内/その他" : taskName(taskCode),
      taskCode: taskCode,
      phaseCode: phaseCode,
      hours,
      memo: el.memo.value.trim(),
      updatedAt: new Date().toISOString()
    };

    if (!entry.date || !entry.staff || (!internal && !entry.customer) || (!internal && !taskCode) || !Number.isFinite(hours) || hours <= 0) {
      showToast("未入力または時間の値を確認してください");
      return;
    }

    const index = state.entries.findIndex((item) => item.id === entry.id);
    try {
      await window.WorklogBackend.saveEntry(entry);
    } catch (error) {
      showToast(error.message);
      return;
    }
    if (index >= 0) {
      state.entries[index] = entry;
      showToast("入力を更新しました");
    } else {
      state.entries.push(entry);
      showToast("入力を登録しました");
    }

    persist();
    resetForm({ keepDate: true, keepStaff: true });
    render();
    if (!el.customer.disabled) el.customer.focus();
  }

  function editEntry(id) {
    const entry = state.entries.find((item) => item.id === id);
    if (!entry) return;

    const isInternal = !entry.customerCode && !entry.taskCode;
    el.editingId.value = entry.id;
    el.workDate.value = entry.date;
    el.staff.value = entry.staffCode || findMasterCodeByName("staff", entry.staff);
    el.taskType.value = isInternal ? INTERNAL_VALUE : (normCode(entry.taskCode) || INTERNAL_VALUE);
    el.customer.value = entry.customerCode || findMasterCodeByName("customers", entry.customer);
    syncCustomerForTask();
    if (el.phase && entry.phaseCode) el.phase.value = entry.phaseCode;
    el.hours.value = entry.hours;
    el.memo.value = entry.memo || "";
    el.saveEntry.textContent = "更新";
    el.cancelEdit.hidden = false;
    syncCalendarToSelectedDate();
    render();
    el.hours.focus();
  }

  async function deleteEntry(id) {
    const entry = state.entries.find((item) => item.id === id);
    if (!entry) return;
    const ok = window.confirm(`${entry.date} ${entry.staff} ${entry.customer} の入力を削除しますか？`);
    if (!ok) return;

    try {
      await window.WorklogBackend.deleteEntry(id);
    } catch (error) {
      showToast(error.message);
      return;
    }
    state.entries = state.entries.filter((item) => item.id !== id);
    persist();
    resetForm({ keepDate: true, keepStaff: true });
    render();
    showToast("入力を削除しました");
  }

  function resetForm(options = {}) {
    const previousDate = el.workDate.value;
    const previousStaff = el.staff.value;
    el.form.reset();
    el.editingId.value = "";
    el.workDate.value = options.keepDate ? previousDate : toDateInput(new Date());
    if (options.keepStaff && previousStaff) el.staff.value = previousStaff;
    el.hours.value = "1";
    el.saveEntry.textContent = "登録";
    el.cancelEdit.hidden = true;
    syncCustomerForTask();
  }

  async function copyPreviousDay() {
    const targetDate = el.workDate.value;
    if (!targetDate) return;
    const previousDate = shiftDate(targetDate, -1);
    const source = state.entries.filter((entry) => entry.date === previousDate);
    if (source.length === 0) {
      showToast("前日の入力がありません");
      return;
    }

    const copies = source.map((entry) => ({
      ...entry,
      id: makeId(),
      date: targetDate,
      updatedAt: new Date().toISOString()
    }));
    try {
      await window.WorklogBackend.saveEntries(copies);
    } catch (error) {
      showToast(error.message);
      return;
    }
    state.entries.push(...copies);
    persist();
    render();
    showToast(`${source.length}件をコピーしました`);
  }

  function render() {
    renderMasters();
    syncCustomerForTask();
    renderCalendar();
    renderDailySummary();
    renderEntries();
    renderCardDayList();
  }

  function renderCalendar() {
    const selectedDate = el.workDate.value;
    const todayValue = toDateInput(new Date());
    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const dayHours = state.entries.reduce((acc, entry) => {
      acc[entry.date] = (acc[entry.date] || 0) + Number(entry.hours || 0);
      return acc;
    }, {});

    el.calendarTitle.textContent = `${year}年${month + 1}月`;

    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    const dayMarkup = Array.from({ length: lastDate }, (_, index) => {
      const date = new Date(year, month, index + 1);
      const value = toDateInput(date);
      const weekday = date.getDay();
      const classes = [
        "calendar-day",
        weekday === 0 ? "is-sunday" : "",
        weekday === 6 ? "is-saturday" : "",
        value === selectedDate ? "is-selected" : "",
        value === todayValue ? "is-today" : ""
      ].filter(Boolean).join(" ");
      const hours = dayHours[value] || 0;
      return `
        <button type="button" class="${classes}" data-date="${value}" aria-label="${formatDate(value)}を表示">
          <span class="calendar-weekday-inline">${weekdays[weekday]}</span>
          <span class="calendar-day-number">${index + 1}</span>
          <span class="calendar-day-hours">${hours ? `${hours.toFixed(1)}h` : ""}</span>
        </button>
      `;
    }).join("");

    el.monthCalendar.innerHTML = dayMarkup;
    el.monthCalendar.querySelectorAll("[data-date]").forEach((button) => {
      button.addEventListener("click", () => selectDate(button.dataset.date));
    });
  }

  function selectDate(value) {
    el.workDate.value = value;
    el.filterFrom.value = value;
    el.filterTo.value = value;
    syncCalendarToSelectedDate();
    render();
  }

  function shiftCalendarMonth(amount) {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + amount, 1);
    renderCalendar();
  }

  function syncCalendarToSelectedDate() {
    if (!el.workDate.value) return;
    const [year, month] = el.workDate.value.split("-").map(Number);
    calendarCursor = new Date(year, month - 1, 1);
  }

  // マスタ編集UIは独立画面（master.html）へ切り出し済み。
  // ここでは入力フォーム・フィルタのスタッフ／顧客／業務区分セレクトを最新マスタで埋めるのみ。
  function renderMasters() {
    fillMasterSelect(el.staff, state.staff, true);
    fillTaskSelect(el.taskType, true);
    fillFilterStaffSelect(el.filterStaff, true);
    fillCustomerSelect(el.customer, true);
  }

  // 案2: 業務区分セレクト（役務タスク＋社内/その他）。工程はマスタ未取得時は taskTypes 名称にフォールバック。
  function fillTaskSelect(select, preserve) {
    const cur = preserve ? select.value : "";
    const svc = serviceTasks();
    let opts;
    if (svc.length) {
      opts = svc.map((t) => ({ code: normCode(t.code), name: t.name }))
        .sort((a, b) => a.code.localeCompare(b.code, "ja"))
        .map((t) => `<option value="${escapeHtml(t.code)}">${escapeHtml(t.code)} ${escapeHtml(t.name)}</option>`);
    } else {
      // 未接続フォールバック（コードなし・名称のみ）
      opts = (state.taskTypes || []).filter((n) => n !== "社内/その他").map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`);
    }
    opts.push(`<option value="${INTERNAL_VALUE}">社内 / その他（非生産）</option>`);
    select.innerHTML = opts.join("");
    if (preserve && Array.from(select.options).some((o) => o.value === cur)) select.value = cur;
  }

  function fillPhaseSelect(code) {
    if (!el.phase || !el.phaseField) return;
    const phases = code ? phasesFor(code) : [];
    if (phases.length >= 2) {
      const cur = el.phase.value;
      el.phase.innerHTML = phases.map((p) => `<option value="${escapeHtml(p.phaseCode)}">${escapeHtml(p.phaseName || p.phaseCode)}</option>`).join("");
      if (phases.some((p) => p.phaseCode === cur)) el.phase.value = cur;
      el.phaseField.hidden = false;
    } else {
      el.phaseField.hidden = true;
      el.phase.innerHTML = phases.length ? `<option value="${escapeHtml(phases[0].phaseCode)}">${escapeHtml(phases[0].phaseName || phases[0].phaseCode)}</option>` : "";
    }
  }

  // 業務コードの正規化（数値化/テキストの不一致を吸収・数値は3桁ゼロ埋め）。allocation.js と同一規則。
  function normCode(v) { const s = String(v == null ? "" : v).trim(); return /^\d+$/.test(s) ? s.padStart(3, "0") : s; }
  function serviceTasks() { return (state.tasks || []).filter((t) => t.allocationType === "service"); }
  function phasesFor(code) { const c = normCode(code); return (state.taskPhases || []).filter((p) => normCode(p.taskCode) === c && Number(p.ratio) > 0).sort((a, b) => a.sortOrder - b.sortOrder); }
  function taskName(code) { const c = normCode(code); const t = (state.tasks || []).find((x) => normCode(x.code) === c); return t ? t.name : code; }
  function currentPhaseCode(code) { const ph = phasesFor(code); if (ph.length >= 2) return el.phase.value || ph[0].phaseCode; return ph.length ? ph[0].phaseCode : "PRE"; }
  // 選択スタッフが選択顧客の担当(PRE/REV)として登録されている場合の役割
  function roleFor(staffCode, custCode) {
    if (!staffCode || !custCode) return "";
    const cs = (state.customerStaff || []).find((x) => String(x.customerCode) === String(custCode) && String(x.staffCode) === String(staffCode));
    return cs ? String(cs.role || "") : "";
  }
  // 工程バッジ（Prepare/Review）。空欄や工程なしは非表示。
  function phaseBadge(code) {
    if (code === "PRE") return ' <span class="phase-badge phase-pre">Prepare</span>';
    if (code === "REV") return ' <span class="phase-badge phase-rev">Review</span>';
    return "";
  }

  function renderDailySummary() {
    const date = el.workDate.value;
    const entries = state.entries.filter((entry) => entry.date === date);
    const totalHours = sum(entries, "hours");
    const customerCount = new Set(entries.map((entry) => entry.customer).filter(Boolean)).size;

    el.selectedDateLabel.textContent = formatDate(date);
    el.dailyHours.textContent = totalHours.toFixed(2);
    el.dailyCount.textContent = String(entries.length);
    el.dailyCustomers.textContent = String(customerCount);
    el.staffSummary.innerHTML = summaryMarkup(groupHours(entries, "staff"));
    el.customerSummary.innerHTML = summaryMarkup(groupHours(entries, "customer"), { demote: "顧客指定なし" });
  }

  function syncCustomerForTask() {
    const taskValue = el.taskType.value;
    const internal = taskValue === INTERNAL_VALUE || !taskValue;
    el.customer.disabled = internal;
    if (internal) el.customer.value = "";
    fillPhaseSelect(internal ? "" : taskValue);
    // 担当者の役割で工程を自動補完＋ロック（担当外・該当役割が無効な工程は手動のまま）
    if (el.phase) el.phase.disabled = false;
    if (!internal && el.phase) {
      const phases = phasesFor(taskValue);
      if (phases.length >= 2) {
        const role = roleFor(el.staff.value, el.customer.value);
        if (role && phases.some((p) => p.phaseCode === role)) {
          el.phase.value = role;
          el.phase.disabled = true;
        }
      }
    }
  }

  function renderCardDayList() {
    const date = el.workDate.value;
    const staffCode = el.staff.value;
    const editingId = el.editingId.value;
    const entries = state.entries
      .filter((entry) => entry.date === date && (entry.staffCode || entry.staff) === staffCode)
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    const total = sum(entries, "hours");
    el.cardDayMeta.textContent = entries.length ? `${entries.length}件 / ${total.toFixed(2)}h` : "";

    if (!staffCode) {
      el.cardDayList.innerHTML = `<div class="empty">スタッフを選択してください</div>`;
      return;
    }
    if (entries.length === 0) {
      el.cardDayList.innerHTML = `<div class="empty">当日の入力はありません</div>`;
      return;
    }

    el.cardDayList.innerHTML = entries.map((entry) => `
      <div class="card-day-row${entry.id === editingId ? " is-editing" : ""}" data-id="${escapeHtml(entry.id)}">
        <div class="cd-main">
          <span class="cd-task">${escapeHtml(entry.taskType)}${phaseBadge(entry.phaseCode)}</span>
          <span class="cd-customer">${escapeHtml(displayCustomer(entry))}</span>
          ${entry.memo ? `<span class="cd-memo">${escapeHtml(entry.memo)}</span>` : ""}
        </div>
        <div class="cd-side">
          <span class="cd-hours">${Number(entry.hours).toFixed(2)}h</span>
          <div class="row-actions">
            <button type="button" class="secondary" data-edit="${escapeHtml(entry.id)}">編集</button>
            <button type="button" class="danger" data-delete="${escapeHtml(entry.id)}">削除</button>
          </div>
        </div>
      </div>
    `).join("");

    el.cardDayList.querySelectorAll("[data-edit]").forEach((button) => {
      button.addEventListener("click", () => editEntry(button.dataset.edit));
    });
    el.cardDayList.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => deleteEntry(button.dataset.delete));
    });
  }

  function renderEntries() {
    const entries = getFilteredEntries().sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return a.staff.localeCompare(b.staff, "ja");
    });

    if (entries.length === 0) {
      el.entryRows.innerHTML = `<tr><td class="empty" colspan="7">入力はありません</td></tr>`;
      return;
    }

    el.entryRows.innerHTML = entries.map((entry) => `
      <tr>
        <td>${escapeHtml(formatDate(entry.date))}</td>
        <td>${escapeHtml(entry.staff)}</td>
        <td>${escapeHtml(displayCustomer(entry))}</td>
        <td>${escapeHtml(entry.taskType)}${phaseBadge(entry.phaseCode)}</td>
        <td class="num">${Number(entry.hours).toFixed(2)}</td>
        <td>${escapeHtml(entry.memo || "")}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="secondary" data-edit="${entry.id}">編集</button>
            <button type="button" class="danger" data-delete="${entry.id}">削除</button>
          </div>
        </td>
      </tr>
    `).join("");

    el.entryRows.querySelectorAll("[data-edit]").forEach((button) => {
      button.addEventListener("click", () => editEntry(button.dataset.edit));
    });
    el.entryRows.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => deleteEntry(button.dataset.delete));
    });
  }

  function getFilteredEntries() {
    const from = el.filterFrom.value;
    const to = el.filterTo.value;
    const staff = el.filterStaff.value;
    const customer = el.filterCustomer.value.trim().toLowerCase();

    return state.entries.filter((entry) => {
      if (from && entry.date < from) return false;
      if (to && entry.date > to) return false;
      if (staff && staff !== "すべて" && (entry.staffCode || entry.staff) !== staff) return false;
      if (customer && !entry.customer.toLowerCase().includes(customer)) return false;
      return true;
    });
  }

  function exportCsv() {
    const rows = getFilteredEntries();
    const header = ["date", "staff_code", "staff", "customer_code", "customer", "task_type", "task_code", "phase_code", "hours", "memo", "updated_at"];
    const body = rows.map((entry) => [
      entry.date,
      entry.staffCode || "",
      entry.staff,
      entry.customerCode || "",
      entry.customer,
      entry.taskType,
      entry.taskCode || "",
      entry.phaseCode || "",
      entry.hours,
      entry.memo || "",
      entry.updatedAt || ""
    ]);
    const csv = [header, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `worklog_${toDateInput(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importCsv(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const text = String(reader.result || "").replace(/^\ufeff/, "");
      const rows = parseCsv(text);
      if (rows.length < 2) {
        showToast("CSVにデータ行がありません");
        return;
      }

      const header = rows[0].map((cell) => cell.trim().toLowerCase());
      const imported = rows.slice(1).map((row) => rowToEntry(header, row)).filter(Boolean);
      if (imported.length === 0) {
        showToast("取り込める行がありませんでした");
        return;
      }

      imported.forEach((entry) => {
        upsertMaster("staff", { code: entry.staffCode || nextCode("S", state.staff), name: entry.staff });
        upsertMaster("customers", { code: entry.customerCode || nextCode("C", state.customers), name: entry.customer });
      });
      try {
        await window.WorklogBackend.saveEntries(imported);
      } catch (error) {
        showToast(error.message);
        return;
      }
      state.entries.push(...imported);
      persist();
      render();
      showToast(`${imported.length}件を取り込みました`);
    };
    reader.readAsText(file, "utf-8");
    event.target.value = "";
  }

  function rowToEntry(header, row) {
    const value = (name) => {
      const index = header.indexOf(name);
      return index >= 0 ? String(row[index] || "").trim() : "";
    };
    const date = value("date") || value("日付");
    const staff = value("staff") || value("スタッフ");
    const staffCode = value("staff_code") || value("社員番号");
    const customer = value("customer") || value("顧客");
    const customerCode = value("customer_code") || value("顧客番号");
    const taskCode = value("task_code") || value("業務コード");
    const phaseCode = value("phase_code") || value("工程");
    const taskType = value("task_type") || value("業務区分") || (taskCode ? taskName(taskCode) : "顧問対応");
    const hours = Number(value("hours") || value("時間"));
    const internal = !customerCode && !taskCode && (taskType === "社内/その他" || !customer);
    if (!date || !staff || (!internal && !customer) || !Number.isFinite(hours) || hours <= 0) return null;
    return {
      id: makeId(),
      date,
      staffCode,
      staff,
      customerCode,
      customer,
      taskType,
      taskCode,
      phaseCode,
      hours,
      memo: value("memo") || value("メモ"),
      updatedAt: new Date().toISOString()
    };
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (quoted) {
        if (char === '"' && next === '"') {
          cell += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          cell += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(cell);
        cell = "";
      } else if (char === "\n") {
        row.push(cell.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }

    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter((items) => items.some((item) => String(item).trim()));
  }

  function fillSelect(select, values, preserveValue) {
    const current = preserveValue ? select.value : "";
    select.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    if (preserveValue && values.includes(current)) select.value = current;
  }

  function fillMasterSelect(select, values, preserveValue) {
    const current = preserveValue ? select.value : "";
    select.innerHTML = values.map((item) => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.code)} ${escapeHtml(item.name)}</option>`).join("");
    if (preserveValue && values.some((item) => item.code === current)) select.value = current;
  }

  function fillFilterStaffSelect(select, preserveValue) {
    const current = preserveValue ? select.value : "";
    const options = [`<option value="すべて">すべて</option>`].concat(
      state.staff.map((item) => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.code)} ${escapeHtml(item.name)}</option>`)
    );
    select.innerHTML = options.join("");
    if (preserveValue && Array.from(select.options).some((option) => option.value === current)) select.value = current;
  }

  function fillCustomerSelect(select, preserveValue) {
    const current = preserveValue ? select.value : "";
    const options = [`<option value="">顧客指定なし</option>`].concat(
      state.customers.map((item) => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.code)} ${escapeHtml(item.name)}</option>`)
    );
    select.innerHTML = options.join("");
    if (preserveValue && Array.from(select.options).some((option) => option.value === current)) select.value = current;
  }

  function summaryMarkup(groups, options = {}) {
    const demote = options.demote;
    const items = Object.entries(groups).sort((a, b) => {
      if (demote) {
        if (a[0] === demote && b[0] !== demote) return 1;
        if (b[0] === demote && a[0] !== demote) return -1;
      }
      return b[1] - a[1];
    });
    if (items.length === 0) return `<div class="empty">入力はありません</div>`;
    return items.map(([name, hours]) => `
      <div class="summary-item">
        <span class="summary-name">${escapeHtml(name)}</span>
        <span class="summary-hours">${hours.toFixed(2)}h</span>
      </div>
    `).join("");
  }

  function groupHours(entries, key) {
    return entries.reduce((acc, entry) => {
      const groupKey = key === "customer" ? displayCustomer(entry) : entry[key];
      acc[groupKey] = (acc[groupKey] || 0) + Number(entry.hours);
      return acc;
    }, {});
  }

  function sum(entries, key) {
    return entries.reduce((total, entry) => total + Number(entry[key] || 0), 0);
  }

  function upsertMaster(type, item, oldCode = "") {
    if (!item.code || !item.name) return;
    if (oldCode && oldCode !== item.code) {
      state[type] = state[type].filter((current) => current.code !== oldCode);
    }
    const existing = state[type].find((current) => current.code === item.code);
    if (existing) {
      existing.name = item.name;
    } else {
      state[type].push(item);
    }
    state[type].sort((a, b) => a.code.localeCompare(b.code, "ja"));
  }

  function upsertCustomerByName(name) {
    if (!name || state.customers.some((item) => item.name === name)) return;
    upsertMaster("customers", { code: nextCode("C", state.customers), name });
  }

  function getMasterName(type, code) {
    return (state[type].find((item) => item.code === code) || {}).name || code;
  }

  function getCustomerCodeByName(name) {
    return (state.customers.find((item) => item.name === normalizeName(name)) || {}).code || "";
  }

  function findMasterCodeByName(type, name) {
    return (state[type].find((item) => item.name === normalizeName(name)) || {}).code || "";
  }

  function displayCustomer(entry) {
    return entry.customer || "顧客指定なし";
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return structuredClone(initialState);
      const parsed = JSON.parse(raw);
      const staff = normalizeMaster(parsed.staff, "S");
      const customers = normalizeMaster(parsed.customers, "C");
      return {
        staff,
        customers,
        taskTypes: Array.isArray(parsed.taskTypes) ? parsed.taskTypes : initialState.taskTypes,
        entries: normalizeEntries(parsed.entries, staff, customers)
      };
    } catch {
      return structuredClone(initialState);
    }
  }

  function normalizeMaster(items, prefix) {
    const source = Array.isArray(items) ? items : [];
    return source.map((item, index) => {
      if (typeof item === "string") return { code: `${prefix}${String(index + 1).padStart(3, "0")}`, name: item };
      return { code: normalizeName(item.code), name: normalizeName(item.name) };
    }).filter((item) => item.code && item.name);
  }

  function normalizeEntries(items, staff, customers) {
    if (!Array.isArray(items)) return [];
    return items.map((entry) => {
      const staffCode = entry.staffCode || findCodeIn(staff, entry.staff);
      const customerCode = entry.customerCode || findCodeIn(customers, entry.customer);
      return {
        ...entry,
        date: normalizeDate(entry.date),
        staffCode,
        staff: entry.staff || findNameIn(staff, staffCode),
        customerCode,
        customer: entry.customer || findNameIn(customers, customerCode)
      };
    });
  }

  function findCodeIn(items, name) {
    return (items.find((item) => item.name === normalizeName(name)) || {}).code || "";
  }

  function findNameIn(items, code) {
    return (items.find((item) => item.code === code) || {}).name || "";
  }

  function normalizeDate(value) {
    const text = String(value || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(text)) return text.replaceAll("/", "-");
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? text : toDateInput(date);
  }

  function nextCode(prefix, items) {
    const max = items.reduce((largest, item) => {
      const match = String(item.code).match(new RegExp(`^${prefix}(\\d+)$`));
      return match ? Math.max(largest, Number(match[1])) : largest;
    }, 0);
    return `${prefix}${String(max + 1).padStart(3, "0")}`;
  }

  function persist() {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function makeId() {
    return `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeName(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function toDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function shiftDate(value, days) {
    const date = new Date(`${value}T00:00:00`);
    date.setDate(date.getDate() + days);
    return toDateInput(date);
  }

  function formatDate(value) {
    if (!value) return "";
    const [year, month, day] = value.split("-");
    return `${year}/${month}/${day}`;
  }

  function csvCell(value) {
    const text = String(value ?? "");
    if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  let toastTimer = null;
  function showToast(message) {
    window.clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.classList.add("show");
    toastTimer = window.setTimeout(() => {
      el.toast.classList.remove("show");
    }, 2200);
  }
})();

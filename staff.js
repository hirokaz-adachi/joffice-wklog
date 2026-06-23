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
  const staffKey = "sharoshiWorklogMvp.selectedStaff";
  const el = {
    form: document.getElementById("entryForm"),
    workDate: document.getElementById("workDate"),
    staff: document.getElementById("staff"),
    customer: document.getElementById("customer"),
    taskType: document.getElementById("taskType"),
    phase: document.getElementById("phase"),
    phaseField: document.getElementById("phaseField"),
    hours: document.getElementById("hours"),
    minusHour: document.getElementById("minusHour"),
    plusHour: document.getElementById("plusHour"),
    minusMinute: document.getElementById("minusMinute"),
    plusMinute: document.getElementById("plusMinute"),
    hourValue: document.getElementById("hourValue"),
    minuteValue: document.getElementById("minuteValue"),
    durationTotal: document.getElementById("durationTotal"),
    memo: document.getElementById("memo"),
    totalHours: document.getElementById("totalHours"),
    todayList: document.getElementById("todayList"),
    toast: document.getElementById("toast")
  };

  init();

  async function init() {
    el.workDate.value = toDateInput(new Date());
    fillMasterSelect(el.staff, state.staff);
    fillTaskSelect(el.taskType);

    const savedStaff = localStorage.getItem(staffKey);
    if (savedStaff && state.staff.some((item) => item.code === savedStaff)) el.staff.value = savedStaff;
    fillCustomerSelect(el.customer); // 選択スタッフの担当を上位に
    syncTask();

    bindEvents();
    await hydrateRemoteState();
    renderToday();
    updateDurationDisplay();
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
        ? remoteState.customerStaff.map((c) => ({ customerCode: String(c.customerCode), staffCode: String(c.staffCode || ""), role: String(c.role || ""), effectiveFrom: String(c.effectiveFrom || "") }))
        : [];
      state.entries = normalizeEntries(remoteState.entries, staff, customers);
      fillMasterSelect(el.staff, state.staff);
      fillTaskSelect(el.taskType);
      const savedStaff = localStorage.getItem(staffKey);
      if (savedStaff && state.staff.some((item) => item.code === savedStaff)) el.staff.value = savedStaff;
      fillCustomerSelect(el.customer);
      syncTask();
      persist();
    } catch (error) {
      showToast(error.message);
    }
  }

  function bindEvents() {
    el.form.addEventListener("submit", saveEntry);
    el.workDate.addEventListener("change", () => {
      fillCustomerSelect(el.customer); // 作業月が変わると担当の並びが変わる
      syncTask();                      // 工程の自動補完も作業月の担当で再評価
      renderToday();
    });
    el.staff.addEventListener("change", () => {
      localStorage.setItem(staffKey, el.staff.value);
      fillCustomerSelect(el.customer); // 担当の並びを選択スタッフに合わせて更新
      renderToday();
      syncTask();
    });
    el.customer.addEventListener("change", syncTask);
    el.taskType.addEventListener("change", syncTask);
    el.minusHour.addEventListener("click", () => changeDuration(-60));
    el.plusHour.addEventListener("click", () => changeDuration(60));
    el.minusMinute.addEventListener("click", () => changeDuration(-15));
    el.plusMinute.addEventListener("click", () => changeDuration(15));
  }

  async function saveEntry(event) {
    event.preventDefault();
    const hours = Number(el.hours.value);
    const taskValue = el.taskType.value;
    const internal = taskValue === INTERNAL_VALUE || !taskValue || taskValue === "社内/その他";
    const taskCode = internal ? "" : taskValue;
    const phaseCode = internal ? "" : currentPhaseCode(taskCode);
    const entry = {
      id: makeId(),
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
      showToast("入力内容を確認してください");
      return;
    }

    try {
      await window.WorklogBackend.saveEntry(entry);
    } catch (error) {
      showToast(error.message);
      return;
    }
    state.entries.push(entry);
    persist();

    el.customer.value = "";
    el.memo.value = "";
    el.hours.value = "1";
    updateDurationDisplay();
    renderToday();
    showToast("追加しました");
    el.customer.focus();
  }

  async function deleteEntry(id) {
    try {
      await window.WorklogBackend.deleteEntry(id);
    } catch (error) {
      showToast(error.message);
      return;
    }
    state.entries = state.entries.filter((entry) => entry.id !== id);
    persist();
    renderToday();
    showToast("削除しました");
  }

  function renderToday() {
    const entries = state.entries
      .filter((entry) => entry.date === el.workDate.value && (entry.staffCode || entry.staff) === el.staff.value)
      .sort((a, b) => (a.updatedAt || "").localeCompare(b.updatedAt || ""));

    const total = entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
    el.totalHours.textContent = formatDuration(total);

    if (entries.length === 0) {
      el.todayList.innerHTML = `<div class="empty">まだ入力はありません</div>`;
      return;
    }

    el.todayList.innerHTML = entries.map((entry) => `
      <article class="today-item">
        <div class="today-main">
          <div class="today-customer">${escapeHtml(displayCustomer(entry))}</div>
          <div class="today-sub">${escapeHtml(entry.taskType)}${phaseBadge(entry.phaseCode)}${entry.memo ? ` / ${escapeHtml(entry.memo)}` : ""}</div>
        </div>
        <div class="today-side">
          <span class="today-hours">${formatDuration(entry.hours)}</span>
          <button type="button" class="delete" data-delete="${entry.id}">削除</button>
        </div>
      </article>
    `).join("");

    el.todayList.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => deleteEntry(button.dataset.delete));
    });
  }

  function fillSelect(select, values) {
    select.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  }

  function fillMasterSelect(select, values) {
    select.innerHTML = values.map((item) => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.code)} ${escapeHtml(item.name)}</option>`).join("");
  }

  // 顧客を選択スタッフの役割でグループ化（①Prepare担当 ②Review担当 ③担当外、各コード昇順）。作業月時点で解決。
  function groupedCustomers(staffCode, month) {
    const m = month != null ? month : workMonthVal();
    const roleMap = window.JOfficeAllocation
      ? window.JOfficeAllocation.resolveAssignees(state.customerStaff || [], m).roleByCustomerStaff
      : new Map();
    const pre = [], rev = [], other = [];
    (state.customers || []).forEach((c) => {
      const role = (roleMap.get(String(c.code)) || {})[String(staffCode)] || "";
      if (role === "PRE") pre.push(c);
      else if (role === "REV") rev.push(c);
      else other.push(c);
    });
    const byCode = (a, b) => String(a.code).localeCompare(String(b.code), "ja");
    return { pre: pre.sort(byCode), rev: rev.sort(byCode), other: other.sort(byCode) };
  }

  function fillCustomerSelect(select) {
    const cur = select.value;
    const g = groupedCustomers(el.staff.value);
    const opt = (c, role) => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.code)} ${escapeHtml(c.name)}${role ? ` (${role === "PRE" ? "Pre" : "Rev"})` : ""}</option>`;
    let html = `<option value="">顧客指定なし</option>`;
    if (g.pre.length || g.rev.length) {
      html += `<optgroup label="担当顧客">`
        + g.pre.map((c) => opt(c, "PRE")).join("")
        + g.rev.map((c) => opt(c, "REV")).join("")
        + `</optgroup>`;
    }
    if (g.other.length) {
      html += `<optgroup label="その他">` + g.other.map((c) => opt(c, "")).join("") + `</optgroup>`;
    }
    select.innerHTML = html;
    if (cur) select.value = cur;
  }

  // 案2: 業務区分セレクト（役務タスク＋社内）・工程セレクタ
  function fillTaskSelect(select) {
    const svc = serviceTasks();
    let opts;
    if (svc.length) {
      opts = svc.map((t) => ({ code: normCode(t.code), name: t.name }))
        .sort((a, b) => a.code.localeCompare(b.code, "ja"))
        .map((t) => `<option value="${escapeHtml(t.code)}">${escapeHtml(t.name)}</option>`);
    } else {
      opts = (state.taskTypes || []).filter((n) => n !== "社内/その他").map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`);
    }
    opts.push(`<option value="${INTERNAL_VALUE}">社内 / その他</option>`);
    select.innerHTML = opts.join("");
  }

  function fillPhaseSelect(code) {
    if (!el.phase || !el.phaseField) return;
    const phases = code ? phasesFor(code) : [];
    if (phases.length >= 2) {
      el.phase.innerHTML = phases.map((p) => `<option value="${escapeHtml(p.phaseCode)}">${escapeHtml(p.phaseName || p.phaseCode)}</option>`).join("");
      el.phaseField.hidden = false;
    } else {
      el.phaseField.hidden = true;
      el.phase.innerHTML = phases.length ? `<option value="${escapeHtml(phases[0].phaseCode)}">${escapeHtml(phases[0].phaseName || phases[0].phaseCode)}</option>` : "";
    }
  }

  function syncTask() {
    const v = el.taskType.value;
    const internal = v === INTERNAL_VALUE || !v;
    el.customer.disabled = internal;
    if (internal) el.customer.value = "";
    fillPhaseSelect(internal ? "" : v);
    // 担当者の役割で工程を自動補完＋ロック（担当外は手動）
    if (el.phase) el.phase.disabled = false;
    if (!internal && el.phase) {
      const phases = phasesFor(v);
      if (phases.length >= 2) {
        const role = roleFor(el.staff.value, el.customer.value);
        if (role && phases.some((p) => p.phaseCode === role)) {
          el.phase.value = role;
          el.phase.disabled = true;
        }
      }
    }
  }

  function normCode(v) { const s = String(v == null ? "" : v).trim(); return /^\d+$/.test(s) ? s.padStart(3, "0") : s; }
  function serviceTasks() { return (state.tasks || []).filter((t) => t.allocationType === "service"); }
  function phasesFor(code) { const c = normCode(code); return (state.taskPhases || []).filter((p) => normCode(p.taskCode) === c && Number(p.ratio) > 0).sort((a, b) => a.sortOrder - b.sortOrder); }
  function taskName(code) { const c = normCode(code); const t = (state.tasks || []).find((x) => normCode(x.code) === c); return t ? t.name : code; }
  function currentPhaseCode(code) { const ph = phasesFor(code); if (ph.length >= 2) return el.phase.value || ph[0].phaseCode; return ph.length ? ph[0].phaseCode : "PRE"; }
  // 顧客担当は時系列マスタ。作業月時点で解決（month 省略時は作業日の月）。
  function workMonthVal() { return String(el.workDate.value || "").slice(0, 7); }
  function roleFor(staffCode, custCode, month) {
    if (!staffCode || !custCode) return "";
    const m = month != null ? month : workMonthVal();
    return window.JOfficeAllocation ? window.JOfficeAllocation.roleAsOf(state.customerStaff || [], custCode, staffCode, m) : "";
  }
  function phaseBadge(code) {
    if (code === "PRE") return ' <span class="phase-badge phase-pre">Prepare</span>';
    if (code === "REV") return ' <span class="phase-badge phase-rev">Review</span>';
    return "";
  }

  function changeDuration(deltaMinutes) {
    const current = Math.round(Number(el.hours.value || 0) * 60);
    const next = Math.min(24 * 60, Math.max(15, current + deltaMinutes));
    el.hours.value = String(next / 60);
    updateDurationDisplay();
  }

  function updateDurationDisplay() {
    const totalMinutes = Math.round(Number(el.hours.value || 0) * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    el.hourValue.textContent = String(hours);
    el.minuteValue.textContent = String(minutes).padStart(2, "0");
    el.durationTotal.textContent = formatDuration(Number(el.hours.value || 0));
  }

  function upsertMaster(type, item) {
    if (!item.code || !item.name) return;
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

  function formatDuration(hoursValue) {
    const totalMinutes = Math.round(Number(hoursValue || 0) * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}時間${String(minutes).padStart(2, "0")}分`;
  }

  function displayCustomer(entry) {
    return entry.customer || "顧客指定なし";
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
    }, 1800);
  }
})();

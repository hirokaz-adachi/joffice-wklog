(function () {
  "use strict";

  // 案2: 配賦は共有エンジン allocation.js（JOfficeAllocation）に委譲する。
  // taskType を捨てる旧ブラウザキャッシュとは相乗りせず、毎回フレッシュ取得（GAS側300秒キャッシュに依存）。

  const state = {
    data: null,
    months: [],
    selectedMonth: "",
    selectedStaffCode: "",
    selectedCustomerCode: "",
    customerModalMonth: "",
    staffSort: "revenue",
    customerSort: "rateAsc",
    customerSearch: ""
  };

  const el = {
    monthSelect: document.getElementById("monthSelect"),
    prevMonth: document.getElementById("prevMonth"),
    nextMonth: document.getElementById("nextMonth"),
    reloadData: document.getElementById("reloadData"),
    dataStatus: document.getElementById("dataStatus"),
    netRevenue: document.getElementById("netRevenue"),
    revenueBreakdown: document.getElementById("revenueBreakdown"),
    taxValue: document.getElementById("taxValue"),
    taxIncluded: document.getElementById("taxIncluded"),
    totalHours: document.getElementById("totalHours"),
    directHours: document.getElementById("directHours"),
    directRatio: document.getElementById("directRatio"),
    averageCustomerRate: document.getElementById("averageCustomerRate"),
    targetRate: document.getElementById("targetRate"),
    targetAmount: document.getElementById("targetAmount"),
    monthlyBars: document.getElementById("monthlyBars"),
    revenueMix: document.getElementById("revenueMix"),
    staffSort: document.getElementById("staffSort"),
    staffRows: document.getElementById("staffRows"),
    staffDetail: document.getElementById("staffDetail"),
    staffModal: document.getElementById("staffModal"),
    closeStaffModal: document.getElementById("closeStaffModal"),
    customerSearch: document.getElementById("customerSearch"),
    customerSort: document.getElementById("customerSort"),
    customerRows: document.getElementById("customerRows"),
    customerModal: document.getElementById("customerModal"),
    closeCustomerModal: document.getElementById("closeCustomerModal"),
    customerDetail: document.getElementById("customerDetail"),
    toast: document.getElementById("toast")
  };

  const ENGINE = window.JOfficeAllocation;

  init();

  async function init() {
    bindEvents();
    await loadData();
  }

  function bindEvents() {
    el.monthSelect.addEventListener("change", () => { state.selectedMonth = el.monthSelect.value; render(); });
    el.prevMonth.addEventListener("click", () => shiftMonth(-1));
    el.nextMonth.addEventListener("click", () => shiftMonth(1));
    el.reloadData.addEventListener("click", () => loadData(true));
    el.staffSort.addEventListener("change", () => { state.staffSort = el.staffSort.value; renderStaffTable(currentModel()); });
    el.staffRows.addEventListener("click", (e) => { const r = e.target.closest("[data-staff-code]"); if (r) selectStaff(r.dataset.staffCode); });
    el.staffRows.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const r = e.target.closest("[data-staff-code]"); if (!r) return; e.preventDefault(); selectStaff(r.dataset.staffCode);
    });
    el.closeStaffModal.addEventListener("click", closeStaffModal);
    el.staffModal.addEventListener("click", (e) => { if (e.target === el.staffModal) closeStaffModal(); });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!el.staffModal.hidden) closeStaffModal();
      if (!el.customerModal.hidden) closeCustomerModal();
    });
    el.customerSort.addEventListener("change", () => { state.customerSort = el.customerSort.value; renderCustomerTable(currentModel()); });
    el.customerSearch.addEventListener("input", () => { state.customerSearch = el.customerSearch.value.trim().toLowerCase(); renderCustomerTable(currentModel()); });
    el.customerRows.addEventListener("click", (e) => { const r = e.target.closest("[data-customer-code]"); if (r) selectCustomer(r.dataset.customerCode); });
    el.customerRows.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const r = e.target.closest("[data-customer-code]"); if (!r) return; e.preventDefault(); selectCustomer(r.dataset.customerCode);
    });
    el.closeCustomerModal.addEventListener("click", closeCustomerModal);
    el.customerModal.addEventListener("click", (e) => { if (e.target === el.customerModal) closeCustomerModal(); });
    el.customerDetail.addEventListener("click", (e) => {
      const col = e.target.closest("[data-trend-month]"); if (!col) return;
      state.customerModalMonth = col.dataset.trendMonth; renderCustomerDetail();
    });
  }

  async function loadData(forceServerRefresh) {
    if (!window.WorklogBackend || !window.WorklogBackend.isRemote()) {
      el.dataStatus.textContent = "スプレッドシート接続が設定されていません";
      showToast("config.js の接続設定が未設定です");
      return;
    }
    const startedAt = performance.now();
    el.reloadData.disabled = true;
    el.dataStatus.textContent = "データを読み込んでいます";
    try {
      const data = await window.WorklogBackend.loadDashboard(Boolean(forceServerRefresh));
      applyData(data);
      const elapsed = (performance.now() - startedAt) / 1000;
      const generatedAt = (data && data.generatedAt) || new Date().toISOString();
      el.dataStatus.textContent = `データ時点 ${formatLoadedDateTime(generatedAt)}（取得 ${elapsed.toFixed(1)}秒）`;
    } catch (error) {
      el.dataStatus.textContent = "読込に失敗しました";
      showToast((error && error.message) || "データを読み込めませんでした");
    } finally {
      el.reloadData.disabled = false;
    }
  }

  function applyData(data) {
    state.data = data || {};
    const billingMonths = (state.data.billing || []).map((b) => String(b.billingMonth)).filter(Boolean);
    const targetMonths = (state.data.targets || []).map((t) => String(t.targetMonth)).filter(Boolean);
    state.months = unique(billingMonths.concat(targetMonths)).sort();
    const anchor = anchorMonth();
    const window12 = lastTwelveMonths(anchor);
    if (!window12.includes(state.selectedMonth)) state.selectedMonth = state.months.at(-1) || anchor;
    renderMonthOptions();
    render();
  }

  function currentModel() {
    return ENGINE.buildMonthModel(state.data || {}, state.selectedMonth);
  }

  function anchorMonth() {
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const latest = state.months.length ? state.months[state.months.length - 1] : "";
    return latest && latest > current ? latest : current;
  }

  function lastTwelveMonths(endMonth) {
    const [year, month] = String(endMonth || "").split("-").map(Number);
    if (!year || !month) return [];
    const result = [];
    for (let offset = 11; offset >= 0; offset -= 1) {
      const d = new Date(year, month - 1 - offset, 1);
      result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return result;
  }

  function renderMonthOptions() {
    el.monthSelect.innerHTML = lastTwelveMonths(anchorMonth()).slice().reverse()
      .map((m) => `<option value="${m}">${formatMonthLabel(m)}</option>`).join("");
    el.monthSelect.value = state.selectedMonth;
  }

  function shiftMonth(direction) {
    const months = lastTwelveMonths(anchorMonth());
    const index = months.indexOf(state.selectedMonth);
    const next = Math.max(0, Math.min(months.length - 1, index + direction));
    if (next === index || next < 0) return;
    state.selectedMonth = months[next];
    el.monthSelect.value = state.selectedMonth;
    render();
  }

  function render() {
    if (!state.data) return;
    const model = currentModel();
    renderKpis(model.firm);
    renderMonthlyBars();
    renderRevenueMix(model);
    renderStaffTable(model);
    if (!el.staffModal.hidden) renderStaffDetail(model);
    renderCustomerTable(model);
    if (!el.customerModal.hidden) { state.customerModalMonth = state.selectedMonth; renderCustomerDetail(); }
    const months = lastTwelveMonths(anchorMonth());
    const i = months.indexOf(state.selectedMonth);
    el.prevMonth.disabled = i <= 0;
    el.nextMonth.disabled = i < 0 || i >= months.length - 1;
  }

  function renderKpis(firm) {
    el.netRevenue.textContent = formatCurrency(firm.grossRevenue);
    el.revenueBreakdown.textContent = `役務 ${formatCurrency(firm.serviceRevenue)}・対象外 ${formatCurrency(firm.excludedRevenue)}`;
    el.taxValue.textContent = formatCurrency(firm.tax);
    el.taxIncluded.textContent = `税込 ${formatCurrency(firm.taxIncluded)}`;
    el.totalHours.textContent = `${formatNumber(firm.totalHours, 1)}h`;
    el.directHours.textContent = `顧客直接 ${formatNumber(firm.directHours, 1)}h`;
    el.directRatio.textContent = formatPercent(firm.totalHours ? firm.directHours / firm.totalHours : 0);
    el.averageCustomerRate.textContent = formatCurrency(firm.avgCustomerRate);
    el.targetRate.textContent = formatPercent(firm.achievement);
    el.targetRate.className = rateClass(firm.achievement);
    el.targetAmount.textContent = `目標 ${formatCurrency(firm.targetTotal)}`;
  }

  // 月次 役務売上 vs 目標（軽量集計・フル配賦は呼ばない）
  function monthlyServiceTarget(month) {
    const taskType = {};
    (state.data.tasks || []).forEach((t) => { taskType[String(t.code)] = t.allocationType || "service"; });
    const service = (state.data.billing || [])
      .filter((b) => String(b.billingMonth) === month)
      .filter((b) => (taskType[String(b.invoiceItemCode || "")] || "service") === "service")
      .reduce((a, b) => a + Number(b.netAmount || 0), 0);
    const target = (state.data.targets || [])
      .filter((t) => String(t.targetMonth) === month)
      .reduce((a, t) => a + Number(t.targetAmount || 0), 0);
    return { service, target };
  }

  function renderMonthlyBars() {
    const months = lastTwelveMonths(anchorMonth());
    const data = months.map((m) => Object.assign({ month: m }, monthlyServiceTarget(m)));
    const maxValue = Math.max(1, ...data.flatMap((p) => [p.service, p.target]));
    el.monthlyBars.innerHTML = data.map((p, index) => {
      const [year, month] = p.month.split("-");
      const prevYear = index > 0 ? data[index - 1].month.split("-")[0] : "";
      const showYear = index === 0 || year !== prevYear;
      const tip = `${formatMonthLabel(p.month)}：役務売上 ${formatCurrency(p.service)} / 目標 ${formatCurrency(p.target)}${p.target ? ` / 達成率 ${formatPercent(p.service / p.target)}` : ""}`;
      const isActive = p.month === state.selectedMonth;
      return `
        <div class="month-column${isActive ? " is-active" : ""}" title="${escapeHtml(tip)}">
          <div class="bar-stage">
            ${barMarkup("revenue", p.service, maxValue, true)}
            ${barMarkup("target", p.target, maxValue, false)}
          </div>
          <div class="month-label">${Number(month)}月<small>${showYear ? year : ""}</small></div>
        </div>`;
    }).join("");
  }

  function barMarkup(type, value, maxValue, showValue) {
    const height = Math.max(3, Math.round((value / maxValue) * 150));
    const label = showValue && value > 0 ? `<span class="bar-value">${formatCompactCurrency(value)}</span>` : "";
    return `<div class="bar ${type}" style="height:${height}px">${label}</div>`;
  }

  function renderRevenueMix(model) {
    const agg = new Map();
    model.customers.forEach((c) => (c.invoiceItems || []).forEach((it) => {
      const cur = agg.get(it.code) || { name: it.name, type: it.type, value: 0 };
      cur.value += it.amount; agg.set(it.code, cur);
    }));
    const mix = [...agg.values()].sort((a, b) => b.value - a.value);
    const max = Math.max(1, ...mix.map((m) => m.value));
    el.revenueMix.innerHTML = mix.map((m) => `
        <div class="mix-row">
          <span>${escapeHtml(m.name)}${typeTag(m.type)}</span>
          <div class="mix-track"><div class="mix-fill" style="width:${(m.value / max) * 100}%"></div></div>
          <strong>${formatCurrency(m.value)}</strong>
        </div>`).join("") || `<p class="empty-row">請求データがありません</p>`;
  }

  function typeTag(type) {
    if (type === "tax") return ` <span class="rev-tag tag-tax">税</span>`;
    if (type === "excluded") return ` <span class="rev-tag tag-excluded">対象外</span>`;
    return "";
  }

  function renderStaffTable(model) {
    const sorters = {
      revenue: (a, b) => b.attributedRevenue - a.attributedRevenue,
      achievement: (a, b) => b.achievement - a.achievement,
      directRate: (a, b) => b.directRate - a.directRate,
      hours: (a, b) => b.totalHours - a.totalHours
    };
    const rows = [...model.staff].sort(sorters[state.staffSort] || sorters.revenue);
    el.staffRows.innerHTML = rows.map((p) => `
      <tr data-staff-code="${escapeHtml(p.code)}" tabindex="0" class="${p.code === state.selectedStaffCode ? "is-selected" : ""}">
        <td><span class="entity-code">${escapeHtml(p.code)}</span><span class="entity-name">${escapeHtml(p.name)}</span></td>
        <td class="num">${formatCurrency(p.attributedRevenue)}</td>
        <td class="num">${formatCurrency(p.target)}</td>
        <td class="num"><span class="${rateClass(p.achievement)}">${formatPercent(p.achievement)}</span></td>
        <td class="num">${formatNumber(p.directHours, 1)}h</td>
        <td class="num">${formatNumber(p.totalHours, 1)}h</td>
        <td class="num ${rateClass(p.directRate / 10000)}">${formatCurrency(p.directRate)}</td>
        <td class="num">${formatCurrency(p.productivity)}</td>
      </tr>`).join("") || `<tr><td class="empty-row" colspan="8">データがありません</td></tr>`;
  }

  function selectStaff(code) {
    state.selectedStaffCode = code;
    const model = currentModel();
    renderStaffTable(model);
    renderStaffDetail(model);
    openStaffModal();
  }

  function renderStaffDetail(model) {
    const p = model.staff.find((s) => s.code === state.selectedStaffCode);
    if (!p) { closeStaffModal(); return; }
    const custRows = p.customers.map((c) => `
      <div class="staff-customer-row">
        <strong>${escapeHtml(c.code)} ${escapeHtml(c.name)}</strong>
        <span>${formatNumber(c.hours, 1)}h</span>
        <span>${formatCurrency(c.attributed)}${c.hours <= 0 ? '<span class="rev-tag tag-fb">フォールバック</span>' : ""}</span>
        <span>${c.rate != null ? `${formatCurrency(c.rate)}/h` : "—"}</span>
      </div>`).join("");
    el.staffDetail.innerHTML = `
      <div class="staff-detail-heading">
        <div><p class="panel-label">Staff Monthly Summary</p>
          <h3 id="staffModalTitle">${escapeHtml(p.code)} ${escapeHtml(p.name)}</h3></div>
        <p>${formatMonthLabel(model.firm.billingMonth)} / 担当顧客 ${p.customers.length}社</p>
      </div>
      <div class="staff-detail-kpis">
        ${kpiBox("帰属売上", formatCurrency(p.attributedRevenue))}
        ${kpiBox("目標達成率", formatPercent(p.achievement), rateClass(p.achievement))}
        ${kpiBox("顧客工数", `${formatNumber(p.directHours, 1)}h`)}
        ${kpiBox("総工数", `${formatNumber(p.totalHours, 1)}h`)}
        ${kpiBox("直接時間単価", formatCurrency(p.directRate))}
        ${kpiBox("総合生産性", formatCurrency(p.productivity))}
      </div>
      <div class="staff-customer-list">
        <p class="staff-detail-note">担当顧客の内訳（帰属売上が大きい順）　工数 / 帰属売上 / 時間単価　※社内・非生産工数 ${formatNumber(p.internalHours, 1)}h</p>
        ${custRows || "<p class=\"empty-row\">当月の担当がありません</p>"}
      </div>`;
  }

  function renderCustomerTable(model) {
    const sorters = {
      rateAsc: (a, b) => rateVal(a.rate) - rateVal(b.rate),
      rateDesc: (a, b) => rateVal(b.rate) - rateVal(a.rate),
      revenue: (a, b) => b.grossRevenue - a.grossRevenue,
      hours: (a, b) => b.hours - a.hours
    };
    const rows = model.customers
      .filter((c) => !state.customerSearch || `${c.code} ${c.name}`.toLowerCase().includes(state.customerSearch))
      .sort(sorters[state.customerSort] || sorters.rateAsc);
    el.customerRows.innerHTML = rows.map((c) => `
      <tr data-customer-code="${escapeHtml(c.code)}" tabindex="0" role="button" class="${c.code === state.selectedCustomerCode ? "is-selected" : ""}">
        <td><span class="entity-code">${escapeHtml(c.code)}</span><span class="entity-name">${escapeHtml(c.name)}</span></td>
        <td class="num">${formatCurrency(c.grossRevenue)}</td>
        <td class="num">${formatNumber(c.hours, 1)}h</td>
        <td class="num ${c.rate != null ? customerRateClass(c.rate) : "rate-na"}">${c.rate != null ? formatCurrency(c.rate) : "—"}</td>
        <td>${escapeHtml(c.primaryStaff)}</td>
        <td><div class="invoice-tags">${(c.invoiceItems || []).map((it) => `<span class="invoice-tag">${escapeHtml(it.name)}</span>`).join("")}</div></td>
      </tr>`).join("") || `<tr><td class="empty-row" colspan="6">該当する顧客がありません</td></tr>`;
  }

  function rateVal(r) { return r == null ? Infinity : r; } // 「—」は末尾へ

  function selectCustomer(code) {
    state.selectedCustomerCode = code;
    state.customerModalMonth = state.selectedMonth;
    renderCustomerTable(currentModel());
    renderCustomerDetail();
    openCustomerModal();
  }

  function renderCustomerDetail() {
    if (!state.selectedCustomerCode) { closeCustomerModal(); return; }
    const detailMonth = state.customerModalMonth || state.selectedMonth;
    const model = ENGINE.buildMonthModel(state.data || {}, detailMonth);
    const c = model.customers.find((x) => x.code === state.selectedCustomerCode)
      || { code: state.selectedCustomerCode, name: (state.data.customers || []).reduce((n, x) => x.code === state.selectedCustomerCode ? x.name : n, state.selectedCustomerCode), grossRevenue: 0, serviceRevenue: 0, excludedRevenue: 0, tax: 0, backedRevenue: 0, unrecordedRevenue: 0, hours: 0, rate: null, primaryStaff: "—", invoiceItems: [], staffBreakdown: [] };

    // 12ヶ月 時間単価トレンド（エンジンを月ごとに評価）
    const months = lastTwelveMonths(anchorMonth());
    const trend = months.map((m) => {
      const mm = ENGINE.buildMonthModel(state.data || {}, m);
      const cc = mm.customers.find((x) => x.code === c.code);
      return { month: m, rate: cc ? cc.rate : null, hours: cc ? cc.hours : 0, service: cc ? cc.serviceRevenue : 0 };
    });
    const maxRate = Math.max(1, ...trend.map((t) => t.rate || 0));

    const staffRows = c.staffBreakdown.map((s) => `
      <div class="staff-customer-row">
        <strong>${escapeHtml(s.name)}${s.role ? ` <span class="rev-tag">${escapeHtml(s.role)}</span>` : ""}</strong>
        <span>${formatNumber(s.hours, 1)}h</span>
        <span>${formatCurrency(s.attributed)}${s.hours <= 0 ? '<span class="rev-tag tag-fb">FB</span>' : ""}</span>
        <span>${s.rate != null ? `${formatCurrency(s.rate)}/h` : "—"}</span>
      </div>`).join("");

    const itemRows = c.invoiceItems.map((it) => `
      <div class="staff-customer-row invoice-row">
        <strong>${escapeHtml(it.name)}${typeTag(it.type)}</strong>
        <span>${formatCurrency(it.amount)}</span>
      </div>`).join("");

    const trendBars = trend.map((t, index) => {
      const has = t.rate != null && t.rate > 0;
      const height = has ? Math.max(6, Math.round((t.rate / maxRate) * 120)) : 0;
      const [year, month] = t.month.split("-");
      const prevYear = index > 0 ? trend[index - 1].month.split("-")[0] : "";
      const showYear = index === 0 || year !== prevYear;
      const tip = `${formatMonthLabel(t.month)}：時間単価 ${t.rate != null ? formatCurrency(t.rate) : "—"} / 役務 ${formatCurrency(t.service)} / 工数 ${formatNumber(t.hours, 1)}h`;
      const bar = has
        ? `<div class="trend-bar ${customerRateClass(t.rate)}" style="height:${height}px"><span class="trend-value">${Math.round(t.rate).toLocaleString("ja-JP")}</span></div>`
        : `<div class="trend-bar is-zero"></div>`;
      return `
        <div class="trend-column${t.month === detailMonth ? " is-active" : ""}" data-trend-month="${t.month}" role="button" tabindex="0" title="${escapeHtml(tip)}">
          <div class="trend-bar-stage">${bar}</div>
          <div class="trend-label">${Number(month)}月<small>${showYear ? year : ""}</small></div>
        </div>`;
    }).join("");

    el.customerDetail.innerHTML = `
      <div class="staff-detail-heading">
        <div><p class="panel-label">Client Profitability</p>
          <h3 id="customerModalTitle">${escapeHtml(c.code)} ${escapeHtml(c.name)}</h3></div>
        <p>${formatMonthLabel(detailMonth)} / 主担当 ${escapeHtml(c.primaryStaff)}</p>
      </div>
      <div class="staff-detail-kpis">
        ${kpiBox("税抜売上(総)", formatCurrency(c.grossRevenue))}
        ${kpiBox("役務売上", formatCurrency(c.serviceRevenue))}
        ${kpiBox("対象外(立替)", formatCurrency(c.excludedRevenue))}
        ${kpiBox("消費税", formatCurrency(c.tax))}
        ${kpiBox("顧客工数", `${formatNumber(c.hours, 1)}h`)}
        ${kpiBox("時間単価", c.rate != null ? formatCurrency(c.rate) : "—（工数未記録）", c.rate != null ? customerRateClass(c.rate) : "")}
      </div>
      <p class="staff-detail-note">うち工数未記録の役務売上（フォールバック）：${formatCurrency(c.unrecordedRevenue)}</p>
      <div class="trend-block">
        <p class="staff-detail-note">時間単価の推移（直近12ヶ月・工数未記録/データなしは0）　バーをクリックでその月の内訳に切替</p>
        <div class="customer-trend">${trendBars}</div>
      </div>
      <div class="customer-detail-cols">
        <div class="staff-customer-list">
          <p class="staff-detail-note">当月の関与スタッフ（役割／工数 / 帰属売上 / 時間単価）</p>
          ${staffRows || "<p class=\"empty-row\">当月の関与がありません</p>"}
        </div>
        <div class="staff-customer-list">
          <p class="staff-detail-note">当月の請求内訳</p>
          ${itemRows || "<p class=\"empty-row\">当月の請求がありません</p>"}
        </div>
      </div>`;
  }

  function kpiBox(label, value, className) {
    return `<div class="staff-detail-kpi"><span>${escapeHtml(label)}</span><strong class="${className || ""}">${escapeHtml(value)}</strong></div>`;
  }

  function openStaffModal() { el.staffModal.hidden = false; document.body.classList.add("has-modal"); window.setTimeout(() => el.closeStaffModal.focus(), 0); }
  function closeStaffModal() { el.staffModal.hidden = true; if (el.customerModal.hidden) document.body.classList.remove("has-modal"); }
  function openCustomerModal() { el.customerModal.hidden = false; document.body.classList.add("has-modal"); window.setTimeout(() => el.closeCustomerModal.focus(), 0); }
  function closeCustomerModal() { el.customerModal.hidden = true; if (el.staffModal.hidden) document.body.classList.remove("has-modal"); }

  // ---- 整形・しきい値（design.md 7-3） ----
  function rateClass(value) { if (value >= 1) return "rate-good"; if (value >= 0.85) return "rate-mid"; return "rate-low"; }
  function customerRateClass(rate) { if (rate >= 10000) return "rate-good"; if (rate >= 7500) return "rate-mid"; return "rate-low"; }
  function formatCurrency(value) { return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(Math.round(value || 0)); }
  function formatCompactCurrency(value) { return `${Math.round((value || 0) / 10000).toLocaleString("ja-JP")}万`; }
  function formatNumber(value, digits) { return Number(value || 0).toLocaleString("ja-JP", { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
  function formatPercent(value) { return `${(Number(value || 0) * 100).toFixed(1)}%`; }
  function formatMonthLabel(month) { const [y, v] = String(month || "").split("-"); return y && v ? `${y}年${Number(v)}月` : month; }
  function formatLoadedDateTime(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "時刻不明";
    return d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function unique(values) { return [...new Set(values)]; }
  function escapeHtml(value) {
    return String(value == null ? "" : value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }
  function showToast(message) {
    el.toast.textContent = message; el.toast.classList.add("is-visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => el.toast.classList.remove("is-visible"), 3200);
  }
})();

(function () {
  "use strict";

  const DASHBOARD_CACHE_KEY = "worklog-dashboard-cache-v2";
  const DASHBOARD_CACHE_TTL_MS = 30 * 60 * 1000;
  const dashboardSource = String((window.WORKLOG_CONFIG || {}).apiBaseUrl || "");

  const state = {
    staff: [],
    customers: [],
    entries: [],
    billing: [],
    targets: [],
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
    invoiceCount: document.getElementById("invoiceCount"),
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

  init();

  async function init() {
    bindEvents();
    await loadData({ useBrowserCache: true });
  }

  function bindEvents() {
    el.monthSelect.addEventListener("change", () => {
      state.selectedMonth = el.monthSelect.value;
      render();
    });
    el.prevMonth.addEventListener("click", () => shiftMonth(-1));
    el.nextMonth.addEventListener("click", () => shiftMonth(1));
    el.reloadData.addEventListener("click", () => loadData({
      useBrowserCache: false,
      forceServerRefresh: true
    }));
    el.staffSort.addEventListener("change", () => {
      state.staffSort = el.staffSort.value;
      renderStaffTable(buildMonthModel(state.selectedMonth));
    });
    el.staffRows.addEventListener("click", (event) => {
      const row = event.target.closest("[data-staff-code]");
      if (row) selectStaff(row.dataset.staffCode);
    });
    el.staffRows.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const row = event.target.closest("[data-staff-code]");
      if (!row) return;
      event.preventDefault();
      selectStaff(row.dataset.staffCode);
    });
    el.closeStaffModal.addEventListener("click", closeStaffModal);
    el.staffModal.addEventListener("click", (event) => {
      if (event.target === el.staffModal) closeStaffModal();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!el.staffModal.hidden) closeStaffModal();
      if (!el.customerModal.hidden) closeCustomerModal();
    });
    el.customerSort.addEventListener("change", () => {
      state.customerSort = el.customerSort.value;
      renderCustomerTable(buildMonthModel(state.selectedMonth));
    });
    el.customerSearch.addEventListener("input", () => {
      state.customerSearch = el.customerSearch.value.trim().toLowerCase();
      renderCustomerTable(buildMonthModel(state.selectedMonth));
    });
    el.customerRows.addEventListener("click", (event) => {
      const row = event.target.closest("[data-customer-code]");
      if (row) selectCustomer(row.dataset.customerCode);
    });
    el.customerRows.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const row = event.target.closest("[data-customer-code]");
      if (!row) return;
      event.preventDefault();
      selectCustomer(row.dataset.customerCode);
    });
    el.closeCustomerModal.addEventListener("click", closeCustomerModal);
    el.customerModal.addEventListener("click", (event) => {
      if (event.target === el.customerModal) closeCustomerModal();
    });
    el.customerDetail.addEventListener("click", (event) => {
      const column = event.target.closest("[data-trend-month]");
      if (!column) return;
      state.customerModalMonth = column.dataset.trendMonth;
      renderCustomerDetail();
    });
    el.customerDetail.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const column = event.target.closest("[data-trend-month]");
      if (!column) return;
      event.preventDefault();
      state.customerModalMonth = column.dataset.trendMonth;
      renderCustomerDetail();
    });
  }

  async function loadData(options) {
    const settings = {
      useBrowserCache: false,
      forceServerRefresh: false,
      ...(options || {})
    };
    if (!window.WorklogBackend || !window.WorklogBackend.isRemote()) {
      showToast("スプレッドシート接続が設定されていません");
      return;
    }

    const startedAt = performance.now();
    let renderedCachedData = false;
    el.reloadData.disabled = true;
    if (settings.useBrowserCache) {
      const cached = readBrowserCache();
      if (cached) {
        applyData(cached.data);
        renderedCachedData = true;
        const cachedTime = formatLoadedDateTime(cached.data.generatedAt || cached.savedAt);
        el.dataStatus.textContent = `前回データ ${cachedTime}・更新中`;
      }
    }
    if (!renderedCachedData) {
      el.dataStatus.textContent = "データを読み込んでいます";
    }

    try {
      const data = await window.WorklogBackend.loadDashboard(settings.forceServerRefresh);
      applyData(data);
      writeBrowserCache(data);
      const elapsed = (performance.now() - startedAt) / 1000;
      const generatedAt = data.generatedAt || new Date().toISOString();
      el.dataStatus.textContent = `データ時点 ${formatLoadedDateTime(generatedAt)}（取得 ${elapsed.toFixed(1)}秒）`;
    } catch (error) {
      if (renderedCachedData) {
        el.dataStatus.textContent = "前回データを表示中・更新に失敗";
        showToast("最新データを取得できなかったため、前回データを表示しています");
      } else {
        el.dataStatus.textContent = "読込に失敗しました";
        showToast(error.message || "データを読み込めませんでした");
      }
    } finally {
      el.reloadData.disabled = false;
    }
  }

  function applyData(data) {
    const source = data || {};
    state.staff = Array.isArray(source.staff) ? source.staff : [];
    state.customers = Array.isArray(source.customers) ? source.customers : [];
    state.entries = Array.isArray(source.entries) ? source.entries.map(normalizeEntry) : [];
    state.billing = Array.isArray(source.billing) ? source.billing.map(normalizeBilling) : [];
    state.targets = Array.isArray(source.targets) ? source.targets.map(normalizeTarget) : [];
    state.months = unique([
      ...state.entries.map((item) => item.month),
      ...state.billing.map((item) => item.billingMonth),
      ...state.targets.map((item) => item.targetMonth)
    ]).filter(Boolean).sort();
    state.selectedMonth = state.months.includes(state.selectedMonth)
      ? state.selectedMonth
      : state.months.at(-1) || "";
    renderMonthOptions();
    render();
  }

  function readBrowserCache() {
    try {
      const value = window.localStorage.getItem(DASHBOARD_CACHE_KEY);
      if (!value) return null;
      const cached = JSON.parse(value);
      const isInvalid = !cached
        || !cached.data
        || !cached.savedAt
        || cached.source !== dashboardSource
        || Date.now() - Number(cached.savedAt) > DASHBOARD_CACHE_TTL_MS;
      if (isInvalid) {
        window.localStorage.removeItem(DASHBOARD_CACHE_KEY);
        return null;
      }
      return cached;
    } catch (error) {
      try {
        window.localStorage.removeItem(DASHBOARD_CACHE_KEY);
      } catch (storageError) {
        // localStorageが利用できない場合は何もしない。
      }
      return null;
    }
  }

  function writeBrowserCache(data) {
    try {
      window.localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        source: dashboardSource,
        data: minimizeDashboardData(data)
      }));
    } catch (error) {
      // Storage容量超過やプライベートモード時も、通常表示は継続する。
    }
  }

  function minimizeDashboardData(data) {
    const source = data || {};
    return {
      generatedAt: source.generatedAt || new Date().toISOString(),
      staff: (source.staff || []).map((item) => ({
        code: item.code,
        name: item.name
      })),
      customers: (source.customers || []).map((item) => ({
        code: item.code,
        name: item.name
      })),
      entries: (source.entries || []).map((item) => ({
        date: item.date,
        staffCode: item.staffCode,
        customerCode: item.customerCode,
        customer: item.customer,
        hours: item.hours
      })),
      billing: (source.billing || []).map((item) => ({
        billingMonth: item.billingMonth,
        customerCode: item.customerCode,
        customer: item.customer,
        invoiceItem: item.invoiceItem,
        netAmount: item.netAmount,
        grossAmount: item.grossAmount
      })),
      targets: (source.targets || []).map((item) => ({
        targetMonth: item.targetMonth,
        staffCode: item.staffCode,
        targetAmount: item.targetAmount
      }))
    };
  }

  function formatLoadedDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "時刻不明";
    return date.toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function normalizeEntry(entry) {
    const date = normalizeDate(entry.date);
    return {
      ...entry,
      date,
      month: date.slice(0, 7),
      hours: Number(entry.hours || 0)
    };
  }

  function normalizeBilling(item) {
    return {
      ...item,
      billingMonth: normalizeMonth(item.billingMonth),
      netAmount: Number(item.netAmount || 0),
      taxAmount: Number(item.taxAmount || 0),
      grossAmount: Number(item.grossAmount || 0)
    };
  }

  function normalizeTarget(item) {
    return {
      ...item,
      targetMonth: normalizeMonth(item.targetMonth),
      targetAmount: Number(item.targetAmount || 0)
    };
  }

  function normalizeDate(value) {
    const text = String(value || "");
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    if (/^\d{4}\/\d{2}\/\d{2}/.test(text)) return text.slice(0, 10).replaceAll("/", "-");
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }

  function normalizeMonth(value) {
    const text = String(value || "");
    if (/^\d{4}[-/]\d{2}/.test(text)) return text.slice(0, 7).replace("/", "-");
    return normalizeDate(value).slice(0, 7);
  }

  function renderMonthOptions() {
    el.monthSelect.innerHTML = state.months
      .map((month) => `<option value="${month}">${formatMonthLabel(month)}</option>`)
      .join("");
    el.monthSelect.value = state.selectedMonth;
  }

  function shiftMonth(direction) {
    const index = state.months.indexOf(state.selectedMonth);
    const next = Math.max(0, Math.min(state.months.length - 1, index + direction));
    if (next === index || next < 0) return;
    state.selectedMonth = state.months[next];
    el.monthSelect.value = state.selectedMonth;
    render();
  }

  function render() {
    const model = buildMonthModel(state.selectedMonth);
    renderKpis(model);
    renderMonthlyBars();
    renderRevenueMix(model);
    renderStaffTable(model);
    if (!el.staffModal.hidden) renderStaffDetail(model);
    renderCustomerTable(model);
    if (!el.customerModal.hidden) {
      state.customerModalMonth = state.selectedMonth;
      renderCustomerDetail();
    }
    const monthIndex = state.months.indexOf(state.selectedMonth);
    el.prevMonth.disabled = monthIndex <= 0;
    el.nextMonth.disabled = monthIndex < 0 || monthIndex >= state.months.length - 1;
  }

  function buildMonthModel(month) {
    const entries = state.entries.filter((entry) => entry.month === month);
    const billing = state.billing.filter((item) => item.billingMonth === month);
    const targets = state.targets.filter((item) => item.targetMonth === month);
    const totalHours = sum(entries.map((entry) => entry.hours));
    const directEntries = entries.filter((entry) => entry.customerCode);
    const directHours = sum(directEntries.map((entry) => entry.hours));
    const netRevenue = sum(billing.map((item) => item.netAmount));
    const grossRevenue = sum(billing.map((item) => item.grossAmount));
    const targetTotal = sum(targets.map((item) => item.targetAmount));

    const customerMap = new Map();
    state.customers.forEach((customer) => {
      customerMap.set(customer.code, {
        code: customer.code,
        name: customer.name,
        hours: 0,
        revenue: 0,
        staffHours: new Map(),
        invoiceItems: new Map()
      });
    });

    directEntries.forEach((entry) => {
      const customer = customerMap.get(entry.customerCode) || {
        code: entry.customerCode,
        name: entry.customer,
        hours: 0,
        revenue: 0,
        staffHours: new Map(),
        invoiceItems: new Map()
      };
      customer.hours += entry.hours;
      customer.staffHours.set(entry.staffCode, (customer.staffHours.get(entry.staffCode) || 0) + entry.hours);
      customerMap.set(entry.customerCode, customer);
    });

    billing.forEach((item) => {
      const customer = customerMap.get(item.customerCode) || {
        code: item.customerCode,
        name: item.customer,
        hours: 0,
        revenue: 0,
        staffHours: new Map(),
        invoiceItems: new Map()
      };
      customer.revenue += item.netAmount;
      customer.invoiceItems.set(item.invoiceItem, (customer.invoiceItems.get(item.invoiceItem) || 0) + item.netAmount);
      customerMap.set(item.customerCode, customer);
    });

    const staffMap = new Map();
    state.staff.forEach((person) => {
      staffMap.set(person.code, {
        code: person.code,
        name: person.name,
        directHours: 0,
        totalHours: 0,
        revenue: 0,
        target: 0,
        customerBreakdown: new Map(),
        workMap: new Map()
      });
    });

    entries.forEach((entry) => {
      const person = staffMap.get(entry.staffCode);
      if (!person) return;
      person.totalHours += entry.hours;
      if (entry.customerCode) person.directHours += entry.hours;
      const workKey = entry.customerCode || "__internal__";
      const work = person.workMap.get(workKey) || {
        code: entry.customerCode || "",
        name: entry.customerCode ? (entry.customer || entry.customerCode) : "社内 / その他（非生産工数）",
        isInternal: !entry.customerCode,
        hours: 0
      };
      work.hours += entry.hours;
      person.workMap.set(workKey, work);
    });

    targets.forEach((target) => {
      const person = staffMap.get(target.staffCode);
      if (person) person.target += target.targetAmount;
    });

    customerMap.forEach((customer) => {
      if (!customer.hours || !customer.revenue) return;
      customer.staffHours.forEach((hours, staffCode) => {
        const person = staffMap.get(staffCode);
        if (!person) return;
        const allocatedRevenue = customer.revenue * (hours / customer.hours);
        person.revenue += allocatedRevenue;
        person.customerBreakdown.set(customer.code, {
          code: customer.code,
          name: customer.name,
          hours,
          revenue: allocatedRevenue,
          rate: hours ? allocatedRevenue / hours : 0
        });
      });
    });

    const customers = [...customerMap.values()]
      .filter((customer) => customer.hours > 0 || customer.revenue > 0)
      .map((customer) => ({
        ...customer,
        rate: customer.hours ? customer.revenue / customer.hours : 0,
        primaryStaff: primaryStaff(customer.staffHours),
        invoiceItems: [...customer.invoiceItems.entries()]
      }));

    const staff = [...staffMap.values()].map((person) => ({
      ...person,
      achievement: person.target ? person.revenue / person.target : 0,
      directRate: person.directHours ? person.revenue / person.directHours : 0,
      productivity: person.totalHours ? person.revenue / person.totalHours : 0,
      directRatio: person.totalHours ? person.directHours / person.totalHours : 0,
      customers: [...person.customerBreakdown.values()].sort((a, b) => b.revenue - a.revenue),
      workBreakdown: [...person.workMap.values()]
        .map((work) => {
          const allocated = person.customerBreakdown.get(work.code);
          const revenue = work.isInternal || !allocated ? 0 : allocated.revenue;
          return {
            ...work,
            revenue,
            rate: !work.isInternal && work.hours ? revenue / work.hours : 0
          };
        })
        .sort((a, b) => Number(a.isInternal) - Number(b.isInternal) || b.hours - a.hours)
    }));

    return {
      month,
      entries,
      billing,
      totalHours,
      directHours,
      netRevenue,
      grossRevenue,
      targetTotal,
      customers,
      staff
    };
  }

  function primaryStaff(staffHours) {
    const best = [...staffHours.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) return "-";
    const person = state.staff.find((item) => item.code === best[0]);
    return person ? person.name : best[0];
  }

  function renderKpis(model) {
    el.netRevenue.textContent = formatCurrency(model.netRevenue);
    el.invoiceCount.textContent = `${model.billing.length}件 / 税込 ${formatCurrency(model.grossRevenue)}`;
    el.totalHours.textContent = `${formatNumber(model.totalHours, 1)}h`;
    el.directHours.textContent = `顧客直接 ${formatNumber(model.directHours, 1)}h`;
    el.directRatio.textContent = formatPercent(model.totalHours ? model.directHours / model.totalHours : 0);
    el.averageCustomerRate.textContent = formatCurrency(model.directHours ? model.netRevenue / model.directHours : 0);
    el.targetRate.textContent = formatPercent(model.targetTotal ? model.netRevenue / model.targetTotal : 0);
    el.targetAmount.textContent = `目標 ${formatCurrency(model.targetTotal)}`;
  }

  function renderMonthlyBars() {
    const months = lastTwelveMonths(anchorMonth());
    const data = months.map((month) => ({
      month,
      net: sum(state.billing.filter((item) => item.billingMonth === month).map((item) => item.netAmount)),
      target: sum(state.targets.filter((item) => item.targetMonth === month).map((item) => item.targetAmount))
    }));
    const maxValue = Math.max(1, ...data.flatMap((point) => [point.net, point.target]));
    el.monthlyBars.innerHTML = data.map((point, index) => {
      const [year, month] = point.month.split("-");
      const prevYear = index > 0 ? data[index - 1].month.split("-")[0] : "";
      const showYear = index === 0 || year !== prevYear;
      const tip = `${formatMonthLabel(point.month)}：売上 ${formatCurrency(point.net)} / 目標 ${formatCurrency(point.target)}${point.target ? ` / 達成率 ${formatPercent(point.net / point.target)}` : ""}`;
      return `
        <div class="month-column" title="${escapeHtml(tip)}">
          <div class="bar-stage">
            ${barMarkup("revenue", point.net, maxValue, true)}
            ${barMarkup("target", point.target, maxValue, false)}
          </div>
          <div class="month-label">${Number(month)}月<small>${showYear ? year : ""}</small></div>
        </div>
      `;
    }).join("");
  }

  function barMarkup(type, value, maxValue, showValue) {
    const height = Math.max(3, Math.round((value / maxValue) * 150));
    const label = showValue && value > 0 ? `<span class="bar-value">${formatCompactCurrency(value)}</span>` : "";
    return `<div class="bar ${type}" style="height:${height}px">${label}</div>`;
  }

  function renderRevenueMix(model) {
    const mix = groupSum(model.billing, "invoiceItem", "netAmount");
    const max = Math.max(1, ...mix.map((item) => item.value));
    el.revenueMix.innerHTML = mix
      .sort((a, b) => b.value - a.value)
      .map((item) => `
        <div class="mix-row">
          <span>${escapeHtml(item.key)}</span>
          <div class="mix-track"><div class="mix-fill" style="width:${(item.value / max) * 100}%"></div></div>
          <strong>${formatCurrency(item.value)}</strong>
        </div>
      `).join("") || `<p class="empty-row">請求データがありません</p>`;
  }

  function renderStaffTable(model) {
    const sorters = {
      revenue: (a, b) => b.revenue - a.revenue,
      achievement: (a, b) => b.achievement - a.achievement,
      directRate: (a, b) => b.directRate - a.directRate,
      hours: (a, b) => b.totalHours - a.totalHours
    };
    const rows = [...model.staff].sort(sorters[state.staffSort]);
    const achievementScale = Math.max(
      1.25,
      Math.ceil(Math.max(0, ...rows.map((person) => person.achievement)) * 4) / 4
    );
    const targetPosition = Math.min(100, (1 / achievementScale) * 100);
    el.staffRows.innerHTML = rows.map((person) => `
      <tr data-staff-code="${escapeHtml(person.code)}"
          tabindex="0"
          aria-selected="${person.code === state.selectedStaffCode}"
          class="${person.code === state.selectedStaffCode ? "is-selected" : ""}">
        <td><span class="entity-code">${escapeHtml(person.code)}</span><span class="entity-name">${escapeHtml(person.name)}</span></td>
        <td class="num">${formatCurrency(person.revenue)}</td>
        <td class="num">${formatCurrency(person.target)}</td>
        <td class="achievement-cell">
          <span class="achievement-value ${rateClass(person.achievement)}">${formatPercent(person.achievement)}</span>
          <div class="achievement-track" title="目標線 100% / 表示上限 ${formatPercent(achievementScale)}">
            <div class="achievement-fill" style="width:${Math.min(targetPosition, (person.achievement / achievementScale) * 100)}%"></div>
            ${person.achievement > 1
              ? `<div class="achievement-fill excess" style="left:${targetPosition}%;width:${Math.min(100 - targetPosition, ((person.achievement - 1) / achievementScale) * 100)}%"></div>`
              : ""}
            <span class="achievement-target" style="left:${targetPosition}%"></span>
          </div>
        </td>
        <td class="num">${formatNumber(person.directHours, 1)}h</td>
        <td class="num">${formatNumber(person.totalHours, 1)}h</td>
        <td class="num ${rateClass(person.directRate / 10000)}">${formatCurrency(person.directRate)}</td>
        <td class="num">${formatCurrency(person.productivity)}</td>
      </tr>
    `).join("");
  }

  function selectStaff(staffCode) {
    state.selectedStaffCode = staffCode;
    const model = buildMonthModel(state.selectedMonth);
    renderStaffTable(model);
    renderStaffDetail(model);
    openStaffModal();
  }

  function renderStaffDetail(model) {
    const person = model.staff.find((item) => item.code === state.selectedStaffCode);
    if (!person) {
      closeStaffModal();
      return;
    }

    const workRows = person.workBreakdown.map((work) => `
      <div class="staff-customer-row${work.isInternal ? " is-internal" : ""}">
        <strong>${work.isInternal ? escapeHtml(work.name) : `${escapeHtml(work.code)} ${escapeHtml(work.name)}`}</strong>
        <span>${formatNumber(work.hours, 1)}h</span>
        <span>${work.revenue ? formatCurrency(work.revenue) : "—"}</span>
        <span>${work.rate ? `${formatCurrency(work.rate)}/h` : "—"}</span>
      </div>
    `).join("");
    const clientCount = person.workBreakdown.filter((work) => !work.isInternal).length;

    el.staffDetail.innerHTML = `
      <div class="staff-detail-heading">
        <div>
          <p class="panel-label">Staff Monthly Summary</p>
          <h3 id="staffModalTitle">${escapeHtml(person.code)} ${escapeHtml(person.name)}</h3>
        </div>
        <p>${formatMonthLabel(model.month)} / 担当顧客 ${clientCount}社</p>
      </div>
      <div class="staff-detail-kpis">
        ${staffDetailKpi("帰属売上", formatCurrency(person.revenue))}
        ${staffDetailKpi("目標達成率", formatPercent(person.achievement), rateClass(person.achievement))}
        ${staffDetailKpi("顧客工数", `${formatNumber(person.directHours, 1)}h`)}
        ${staffDetailKpi("総工数", `${formatNumber(person.totalHours, 1)}h`)}
        ${staffDetailKpi("顧客業務比率", formatPercent(person.directRatio))}
        ${staffDetailKpi("直接時間単価", formatCurrency(person.directRate))}
      </div>
      <div class="staff-customer-list">
        <p class="staff-detail-note">当月の工数内訳（顧客＋社内／非生産工数を含む・工数の多い順）　工数 / 帰属売上 / 時間単価</p>
        ${workRows || "<p class=\"empty-row\">当月の工数がありません</p>"}
      </div>
    `;
  }

  function openStaffModal() {
    el.staffModal.hidden = false;
    document.body.classList.add("has-modal");
    window.setTimeout(() => el.closeStaffModal.focus(), 0);
  }

  function closeStaffModal() {
    el.staffModal.hidden = true;
    document.body.classList.remove("has-modal");
    const selectedRow = el.staffRows.querySelector(`[data-staff-code="${cssEscape(state.selectedStaffCode)}"]`);
    if (selectedRow) selectedRow.focus();
  }

  function staffDetailKpi(label, value, className) {
    return `
      <div class="staff-detail-kpi">
        <span>${escapeHtml(label)}</span>
        <strong class="${className || ""}">${escapeHtml(value)}</strong>
      </div>
    `;
  }

  function renderCustomerTable(model) {
    const sorters = {
      rateAsc: (a, b) => a.rate - b.rate,
      rateDesc: (a, b) => b.rate - a.rate,
      revenue: (a, b) => b.revenue - a.revenue,
      hours: (a, b) => b.hours - a.hours
    };
    const rows = model.customers
      .filter((customer) => {
        if (!state.customerSearch) return true;
        return `${customer.code} ${customer.name}`.toLowerCase().includes(state.customerSearch);
      })
      .sort(sorters[state.customerSort]);
    el.customerRows.innerHTML = rows.map((customer) => `
      <tr data-customer-code="${escapeHtml(customer.code)}"
          tabindex="0"
          role="button"
          aria-label="${escapeHtml(customer.code)} ${escapeHtml(customer.name)} の詳細"
          class="${customer.code === state.selectedCustomerCode ? "is-selected" : ""}">
        <td><span class="entity-code">${escapeHtml(customer.code)}</span><span class="entity-name">${escapeHtml(customer.name)}</span></td>
        <td class="num">${formatCurrency(customer.revenue)}</td>
        <td class="num">${formatNumber(customer.hours, 1)}h</td>
        <td class="num ${customerRateClass(customer.rate)}">${formatCurrency(customer.rate)}</td>
        <td>${escapeHtml(customer.primaryStaff)}</td>
        <td><div class="invoice-tags">${customer.invoiceItems.map(([name]) => `<span class="invoice-tag">${escapeHtml(name)}</span>`).join("")}</div></td>
      </tr>
    `).join("") || `<tr><td class="empty-row" colspan="6">該当する顧客がありません</td></tr>`;
  }

  function selectCustomer(customerCode) {
    state.selectedCustomerCode = customerCode;
    state.customerModalMonth = state.selectedMonth;
    renderCustomerTable(buildMonthModel(state.selectedMonth));
    renderCustomerDetail();
    openCustomerModal();
  }

  function renderCustomerDetail() {
    if (!state.selectedCustomerCode) {
      closeCustomerModal();
      return;
    }
    const trendEnd = anchorMonth();
    const detailMonth = state.customerModalMonth || trendEnd;
    const customer = buildCustomerMonth(state.selectedCustomerCode, detailMonth);

    const trend = buildCustomerTrend(customer.code, trendEnd);
    const trendHours = sum(trend.map((point) => point.hours));
    const trendRevenue = sum(trend.map((point) => point.revenue));
    const avgRate = trendHours ? trendRevenue / trendHours : 0;
    const maxRate = Math.max(1, ...trend.map((point) => point.rate));

    const staffRows = [...customer.staffHours.entries()]
      .map(([staffCode, hours]) => {
        const revenue = customer.hours ? customer.revenue * (hours / customer.hours) : 0;
        return { name: staffName(staffCode), hours, revenue, rate: hours ? revenue / hours : 0 };
      })
      .sort((a, b) => b.hours - a.hours)
      .map((item) => `
        <div class="staff-customer-row">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${formatNumber(item.hours, 1)}h</span>
          <span>${formatCurrency(item.revenue)}</span>
          <span>${item.rate ? `${formatCurrency(item.rate)}/h` : "—"}</span>
        </div>
      `).join("");

    const invoiceRows = customer.invoiceItems
      .slice()
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => `
        <div class="staff-customer-row invoice-row">
          <strong>${escapeHtml(name)}</strong>
          <span>${formatCurrency(amount)}</span>
        </div>
      `).join("");

    const trendBars = trend.map((point, index) => {
      const height = point.rate > 0 ? Math.max(6, Math.round((point.rate / maxRate) * 120)) : 0;
      const [year, month] = point.month.split("-");
      const prevYear = index > 0 ? trend[index - 1].month.split("-")[0] : "";
      const showYear = index === 0 || year !== prevYear;
      const tip = `${formatMonthLabel(point.month)}：時間単価 ${formatCurrency(point.rate)} / 売上 ${formatCurrency(point.revenue)} / 工数 ${formatNumber(point.hours, 1)}h`;
      const bar = point.rate > 0
        ? `<div class="trend-bar ${customerRateClass(point.rate)}" style="height:${height}px"><span class="trend-value">${formatRateLabel(point.rate)}</span></div>`
        : `<div class="trend-bar is-zero"></div>`;
      const isActive = point.month === detailMonth;
      return `
        <div class="trend-column${isActive ? " is-active" : ""}" data-trend-month="${point.month}" role="button" tabindex="0" title="${escapeHtml(tip)}">
          <div class="trend-bar-stage">${bar}</div>
          <div class="trend-label">${Number(month)}月<small>${showYear ? year : ""}</small></div>
        </div>
      `;
    }).join("");

    el.customerDetail.innerHTML = `
      <div class="staff-detail-heading">
        <div>
          <p class="panel-label">Client Profitability</p>
          <h3 id="customerModalTitle">${escapeHtml(customer.code)} ${escapeHtml(customer.name)}</h3>
        </div>
        <p>${formatMonthLabel(detailMonth)} / 主担当 ${escapeHtml(customer.primaryStaff)}</p>
      </div>
      <div class="staff-detail-kpis">
        ${staffDetailKpi("当月税抜売上", formatCurrency(customer.revenue))}
        ${staffDetailKpi("当月顧客工数", `${formatNumber(customer.hours, 1)}h`)}
        ${staffDetailKpi("当月時間単価", formatCurrency(customer.rate), customerRateClass(customer.rate))}
        ${staffDetailKpi("12ヶ月平均単価", formatCurrency(avgRate))}
        ${staffDetailKpi("12ヶ月売上", formatCurrency(trendRevenue))}
        ${staffDetailKpi("12ヶ月工数", `${formatNumber(trendHours, 1)}h`)}
      </div>
      <div class="trend-block">
        <p class="staff-detail-note">時間単価の推移（直近12ヶ月・データのない月は0）　バーをクリックでその月の内訳に切替</p>
        <div class="customer-trend">${trendBars}</div>
      </div>
      <div class="customer-detail-cols">
        <div class="staff-customer-list">
          <p class="staff-detail-note">当月の関与スタッフ（工数の多い順）　工数 / 帰属売上 / 時間単価</p>
          ${staffRows || "<p class=\"empty-row\">当月の工数がありません</p>"}
        </div>
        <div class="staff-customer-list">
          <p class="staff-detail-note">当月の請求内訳</p>
          ${invoiceRows || "<p class=\"empty-row\">当月の請求がありません</p>"}
        </div>
      </div>
    `;
  }

  function buildCustomerMonth(customerCode, month) {
    const master = state.customers.find((item) => item.code === customerCode);
    const entries = state.entries.filter((entry) => entry.month === month && entry.customerCode === customerCode);
    const billing = state.billing.filter((item) => item.billingMonth === month && item.customerCode === customerCode);
    const hours = sum(entries.map((entry) => entry.hours));
    const revenue = sum(billing.map((item) => item.netAmount));
    const staffHours = new Map();
    entries.forEach((entry) => staffHours.set(entry.staffCode, (staffHours.get(entry.staffCode) || 0) + entry.hours));
    const invoiceMap = new Map();
    billing.forEach((item) => invoiceMap.set(item.invoiceItem, (invoiceMap.get(item.invoiceItem) || 0) + item.netAmount));
    return {
      code: customerCode,
      name: master ? master.name : customerCode,
      month,
      hours,
      revenue,
      rate: hours ? revenue / hours : 0,
      staffHours,
      invoiceItems: [...invoiceMap.entries()],
      primaryStaff: primaryStaff(staffHours)
    };
  }

  function buildCustomerTrend(customerCode, endMonth) {
    return lastTwelveMonths(endMonth).map((month) => {
      const hours = sum(state.entries
        .filter((entry) => entry.month === month && entry.customerCode === customerCode)
        .map((entry) => entry.hours));
      const revenue = sum(state.billing
        .filter((item) => item.billingMonth === month && item.customerCode === customerCode)
        .map((item) => item.netAmount));
      return { month, hours, revenue, rate: hours ? revenue / hours : 0 };
    });
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
      const date = new Date(year, month - 1 - offset, 1);
      result.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
    }
    return result;
  }

  function staffName(staffCode) {
    const person = state.staff.find((item) => item.code === staffCode);
    return person ? person.name : staffCode;
  }

  function formatRateLabel(value) {
    return value > 0 ? Math.round(value).toLocaleString("ja-JP") : "";
  }

  function openCustomerModal() {
    el.customerModal.hidden = false;
    document.body.classList.add("has-modal");
    window.setTimeout(() => el.closeCustomerModal.focus(), 0);
  }

  function closeCustomerModal() {
    el.customerModal.hidden = true;
    if (el.staffModal.hidden) document.body.classList.remove("has-modal");
    const selectedRow = el.customerRows.querySelector(`[data-customer-code="${cssEscape(state.selectedCustomerCode)}"]`);
    if (selectedRow) selectedRow.focus();
  }

  function groupSum(items, keyField, valueField) {
    const map = new Map();
    items.forEach((item) => map.set(item[keyField], (map.get(item[keyField]) || 0) + Number(item[valueField] || 0)));
    return [...map.entries()].map(([key, value]) => ({ key, value }));
  }

  function rateClass(value) {
    if (value >= 1) return "rate-good";
    if (value >= 0.85) return "rate-mid";
    return "rate-low";
  }

  function customerRateClass(rate) {
    if (rate >= 10000) return "rate-good";
    if (rate >= 7500) return "rate-mid";
    return "rate-low";
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency: "JPY",
      maximumFractionDigits: 0
    }).format(Math.round(value || 0));
  }

  function formatCompactCurrency(value) {
    return `${Math.round((value || 0) / 10000).toLocaleString("ja-JP")}万`;
  }

  function formatNumber(value, digits) {
    return Number(value || 0).toLocaleString("ja-JP", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function formatPercent(value) {
    return `${(Number(value || 0) * 100).toFixed(1)}%`;
  }

  function formatMonthLabel(month) {
    const [year, value] = String(month || "").split("-");
    return year && value ? `${year}年${Number(value)}月` : month;
  }

  function sum(values) {
    return values.reduce((total, value) => total + Number(value || 0), 0);
  }

  function unique(values) {
    return [...new Set(values)];
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(String(value || ""));
    return String(value || "").replace(/["\\]/g, "\\$&");
  }

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add("is-visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => el.toast.classList.remove("is-visible"), 3200);
  }
})();

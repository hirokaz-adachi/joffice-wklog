(function () {
  "use strict";

  // 詳細分析画面（工数フェーズ）。
  // 売上系指標（帰属売上・時間単価・達成率）は配賦の非対称（design.md 第7-1）の影響を受けるため、
  // 案2（design.md 第8章）決着後に追加する。本画面は工数中心の探索分析に振り切る。
  //
  // データは dashboard API をそのまま再利用する（GAS変更なし）。ただしダッシュボードの
  // ブラウザキャッシュ（worklog-dashboard-cache-v2）は taskType を捨てるため相乗りできない。
  // 業務区分軸を成立させるため、本画面は毎回フレッシュ取得し GAS 側キャッシュ（既定300秒）に依存する。

  const AXES = {
    staff: "スタッフ",
    customer: "顧客",
    taskType: "業務区分"
  };
  const INTERNAL_KEY = "__internal__";
  const INTERNAL_LABEL = "社内 / その他（非生産工数）";
  const UNSET_TASK_LABEL = "（業務区分なし）";
  // 系列カラー（teal基調 + 識別用アクセント）。上位8カテゴリに割当、それ以外は「その他」グレー。
  const PALETTE = [
    "#0f766e", "#2563eb", "#b45309", "#7c3aed", "#0891b2",
    "#be185d", "#15803d", "#9f1239"
  ];
  const OTHER_COLOR = "#94a3b8";
  const TOP_SERIES = 8;

  const state = {
    staff: [],
    customers: [],
    entries: [],
    months: [],
    selectableMonths: [],
    startMonth: "",
    endMonth: "",
    mainAxis: "staff",
    includeInternal: true,
    pivotRow: "staff",
    pivotCol: "taskType"
  };

  const el = {
    startMonth: document.getElementById("startMonth"),
    endMonth: document.getElementById("endMonth"),
    mainAxis: document.getElementById("mainAxis"),
    includeInternal: document.getElementById("includeInternal"),
    pivotRow: document.getElementById("pivotRow"),
    pivotCol: document.getElementById("pivotCol"),
    reloadData: document.getElementById("reloadData"),
    dataStatus: document.getElementById("dataStatus"),
    periodNote: document.getElementById("periodNote"),
    sumTotal: document.getElementById("sumTotal"),
    sumDirect: document.getElementById("sumDirect"),
    sumInternal: document.getElementById("sumInternal"),
    sumDirectRatio: document.getElementById("sumDirectRatio"),
    sumMonths: document.getElementById("sumMonths"),
    sumEntries: document.getElementById("sumEntries"),
    trendTitle: document.getElementById("trendTitle"),
    trendLegend: document.getElementById("trendLegend"),
    trendChart: document.getElementById("trendChart"),
    rankTitle: document.getElementById("rankTitle"),
    rankList: document.getElementById("rankList"),
    pivotWrap: document.getElementById("pivotWrap"),
    toast: document.getElementById("toast")
  };

  init();

  async function init() {
    bindEvents();
    await loadData();
  }

  function bindEvents() {
    el.startMonth.addEventListener("change", () => {
      state.startMonth = el.startMonth.value;
      if (state.startMonth > state.endMonth) {
        state.endMonth = state.startMonth;
        el.endMonth.value = state.endMonth;
      }
      render();
    });
    el.endMonth.addEventListener("change", () => {
      state.endMonth = el.endMonth.value;
      if (state.endMonth < state.startMonth) {
        state.startMonth = state.endMonth;
        el.startMonth.value = state.startMonth;
      }
      render();
    });
    el.mainAxis.addEventListener("change", () => {
      state.mainAxis = el.mainAxis.value;
      render();
    });
    el.includeInternal.addEventListener("change", () => {
      state.includeInternal = el.includeInternal.checked;
      render();
    });
    el.pivotRow.addEventListener("change", () => {
      state.pivotRow = el.pivotRow.value;
      renderPivot(periodEntries());
    });
    el.pivotCol.addEventListener("change", () => {
      state.pivotCol = el.pivotCol.value;
      renderPivot(periodEntries());
    });
    el.reloadData.addEventListener("click", () => loadData(true));
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
    const source = data || {};
    state.staff = Array.isArray(source.staff) ? source.staff : [];
    state.customers = Array.isArray(source.customers) ? source.customers : [];
    state.entries = Array.isArray(source.entries) ? source.entries.map(normalizeEntry) : [];
    state.months = unique(state.entries.map((entry) => entry.month)).filter(Boolean).sort();
    state.selectableMonths = buildSelectableMonths();

    // 既定の集計期間はデータのある範囲。データが無い月も選択肢には含める（ゼロ表示）。
    if (!state.selectableMonths.includes(state.startMonth)) {
      state.startMonth = state.months[0] || state.selectableMonths[0] || "";
    }
    if (!state.selectableMonths.includes(state.endMonth)) {
      state.endMonth = state.months.at(-1) || state.selectableMonths.at(-1) || "";
    }
    renderMonthOptions();
    render();
  }

  // 選択可能な月レンジ。ダッシュボードと同様にアンカー月（直近データ月 or 当月）を終端とし、
  // 「データ最古月」と「直近12ヶ月窓の先頭」のうち早い方を始端とする連続月。データの無い月も選べる。
  function buildSelectableMonths() {
    const anchor = anchorMonth();
    if (!anchor) return state.months.slice();
    const windowStart = shiftMonthStr(anchor, -11);
    const dataStart = state.months[0] || "";
    let start = windowStart;
    if (dataStart && dataStart < start) start = dataStart;
    let end = anchor;
    const dataEnd = state.months.at(-1) || "";
    if (dataEnd && dataEnd > end) end = dataEnd;
    return contiguousMonths(start, end);
  }

  function renderMonthOptions() {
    const options = state.selectableMonths
      .map((month) => `<option value="${month}">${formatMonthLabel(month)}</option>`)
      .join("");
    el.startMonth.innerHTML = options;
    el.endMonth.innerHTML = options;
    el.startMonth.value = state.startMonth;
    el.endMonth.value = state.endMonth;
  }

  // 期間レンジ内のエントリ。社内工数トグルが OFF のときは顧客直接（customerCodeあり）のみ。
  function periodEntries() {
    const lo = state.startMonth;
    const hi = state.endMonth;
    return state.entries.filter((entry) => {
      if (lo && entry.month < lo) return false;
      if (hi && entry.month > hi) return false;
      if (!state.includeInternal && !entry.customerCode) return false;
      return true;
    });
  }

  function render() {
    const periodAll = state.entries.filter((entry) => {
      if (state.startMonth && entry.month < state.startMonth) return false;
      if (state.endMonth && entry.month > state.endMonth) return false;
      return true;
    });
    renderPeriodNote();
    renderSummary(periodAll);
    const scoped = periodEntries();
    renderTrend(scoped);
    renderRanking(scoped);
    renderPivot(scoped);
  }

  function renderPeriodNote() {
    const span = state.startMonth === state.endMonth
      ? formatMonthLabel(state.startMonth)
      : `${formatMonthLabel(state.startMonth)} 〜 ${formatMonthLabel(state.endMonth)}`;
    el.periodNote.textContent = state.months.length
      ? `集計期間：${span}（推移・ランキング・クロス集計は「社内・非生産工数を含める」設定に従います）`
      : "工数データがありません";
  }

  // サマリは期間内の全工数（社内含む）で集計し、直接／社内の内訳を常に提示する。
  function renderSummary(periodAll) {
    const total = sum(periodAll.map((entry) => entry.hours));
    const direct = sum(periodAll.filter((entry) => entry.customerCode).map((entry) => entry.hours));
    const internal = total - direct;
    const monthCount = unique(periodAll.map((entry) => entry.month)).filter(Boolean).length;
    el.sumTotal.textContent = `${formatNumber(total, 1)}h`;
    el.sumDirect.textContent = `${formatNumber(direct, 1)}h`;
    el.sumInternal.textContent = `${formatNumber(internal, 1)}h`;
    el.sumDirectRatio.textContent = formatPercent(total ? direct / total : 0);
    el.sumMonths.textContent = `${monthCount}ヶ月`;
    el.sumEntries.textContent = `${periodAll.length.toLocaleString("ja-JP")}件`;
  }

  // 選択中の主軸でエントリを分類する。{ key, label } を返す。
  function axisOf(entry, axis) {
    if (axis === "staff") {
      return { key: entry.staffCode || "(未設定)", label: staffLabel(entry.staffCode, entry.staff) };
    }
    if (axis === "customer") {
      if (!entry.customerCode) return { key: INTERNAL_KEY, label: INTERNAL_LABEL };
      return { key: entry.customerCode, label: customerLabel(entry.customerCode, entry.customer) };
    }
    // taskType
    const task = String(entry.taskType || "").trim();
    return { key: task || "__unset_task__", label: task || UNSET_TASK_LABEL };
  }

  function aggregateByAxis(entries, axis) {
    const map = new Map();
    entries.forEach((entry) => {
      const { key, label } = axisOf(entry, axis);
      const row = map.get(key) || { key, label, hours: 0 };
      row.hours += entry.hours;
      map.set(key, row);
    });
    return [...map.values()].sort((a, b) => b.hours - a.hours);
  }

  // 上位 TOP_SERIES を個別色、それ以外は「その他」に集約するためのカラーマップを作る。
  function buildColorMap(rankedCategories) {
    const map = new Map();
    rankedCategories.forEach((cat, index) => {
      map.set(cat.key, index < TOP_SERIES ? PALETTE[index] : OTHER_COLOR);
    });
    return map;
  }

  function renderTrend(entries) {
    el.trendTitle.textContent = `月次工数推移（${AXES[state.mainAxis]}別）`;
    const months = monthsInRange();
    const ranked = aggregateByAxis(entries, state.mainAxis);

    if (!months.length) {
      el.trendLegend.innerHTML = "";
      el.trendChart.innerHTML = `<p class="empty-row">集計期間が選択されていません</p>`;
      return;
    }

    const topKeys = ranked.slice(0, TOP_SERIES).map((cat) => cat.key);
    const topKeySet = new Set(topKeys);
    const hasOther = ranked.length > TOP_SERIES;

    // 凡例（上位カテゴリ + その他）
    const legendItems = ranked.slice(0, TOP_SERIES).map((cat, index) => legendItem(PALETTE[index], cat.label));
    if (hasOther) legendItems.push(legendItem(OTHER_COLOR, `その他（${ranked.length - TOP_SERIES}件）`));
    el.trendLegend.innerHTML = legendItems.join("");

    // 月 × カテゴリ の工数を集計
    const perMonth = months.map((month) => {
      const monthEntries = entries.filter((entry) => entry.month === month);
      const segMap = new Map();
      let total = 0;
      monthEntries.forEach((entry) => {
        const { key, label } = axisOf(entry, state.mainAxis);
        const bucketKey = topKeySet.has(key) ? key : "__other__";
        const seg = segMap.get(bucketKey) || {
          key: bucketKey,
          label: bucketKey === "__other__" ? "その他" : label,
          color: bucketKey === "__other__" ? OTHER_COLOR : PALETTE[topKeys.indexOf(key)],
          hours: 0
        };
        seg.hours += entry.hours;
        total += entry.hours;
        segMap.set(bucketKey, seg);
      });
      // 凡例と同じ並び（上位→その他）でスタックを積む
      const order = [...topKeys, "__other__"];
      const segments = order
        .map((k) => segMap.get(k))
        .filter(Boolean)
        .filter((seg) => seg.hours > 0);
      return { month, total, segments };
    });

    const maxTotal = Math.max(1, ...perMonth.map((point) => point.total));
    el.trendChart.innerHTML = perMonth.map((point, index) => {
      const [year, month] = point.month.split("-");
      const prevYear = index > 0 ? perMonth[index - 1].month.split("-")[0] : "";
      const showYear = index === 0 || year !== prevYear;
      const stackHeight = Math.round((point.total / maxTotal) * 200);
      const tipLines = point.segments
        .map((seg) => `${seg.label}：${formatNumber(seg.hours, 1)}h`)
        .join(" / ");
      const tip = `${formatMonthLabel(point.month)}　合計 ${formatNumber(point.total, 1)}h${tipLines ? `（${tipLines}）` : ""}`;
      const segHtml = point.segments.map((seg) => {
        const h = point.total ? Math.max(2, Math.round((seg.hours / point.total) * stackHeight)) : 0;
        return `<div class="stack-seg" style="height:${h}px;background:${seg.color}" title="${escapeHtml(seg.label)}：${formatNumber(seg.hours, 1)}h"></div>`;
      }).join("");
      return `
        <div class="stack-column" title="${escapeHtml(tip)}">
          <span class="stack-total">${point.total > 0 ? formatNumber(point.total, 0) : ""}</span>
          <div class="stack-stage"><div class="stack-bar" style="height:${stackHeight}px">${segHtml}</div></div>
          <div class="stack-label">${Number(month)}月<small>${showYear ? year : ""}</small></div>
        </div>
      `;
    }).join("");
  }

  function legendItem(color, label) {
    return `<span class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${escapeHtml(label)}</span>`;
  }

  function renderRanking(entries) {
    el.rankTitle.textContent = `工数ランキング・構成比（${AXES[state.mainAxis]}別）`;
    const ranked = aggregateByAxis(entries, state.mainAxis);
    const grand = sum(ranked.map((cat) => cat.hours));
    const colorMap = buildColorMap(ranked);
    const monthCount = Math.max(1, monthsInRange().length);

    if (!ranked.length) {
      el.rankList.innerHTML = `<p class="empty-row">対象期間のデータがありません</p>`;
      return;
    }
    const max = Math.max(1, ...ranked.map((cat) => cat.hours));
    el.rankList.innerHTML = ranked.map((cat, index) => {
      const share = grand ? cat.hours / grand : 0;
      return `
        <div class="rank-row">
          <span class="rank-no">${index + 1}</span>
          <span class="rank-swatch" style="background:${colorMap.get(cat.key)}"></span>
          <span class="rank-name">${escapeHtml(cat.label)}</span>
          <div class="rank-track"><div class="rank-fill" style="width:${(cat.hours / max) * 100}%;background:${colorMap.get(cat.key)}"></div></div>
          <span class="rank-hours">${formatNumber(cat.hours, 1)}h</span>
          <span class="rank-share">${formatPercent(share)}</span>
          <span class="rank-avg">月平均 ${formatNumber(cat.hours / monthCount, 1)}h</span>
        </div>
      `;
    }).join("");
  }

  function renderPivot(entries) {
    const rowAxis = state.pivotRow;
    const colAxis = state.pivotCol;
    const rowCats = aggregateByAxis(entries, rowAxis);
    const colCats = aggregateByAxis(entries, colAxis);

    if (!entries.length || !rowCats.length || !colCats.length) {
      el.pivotWrap.innerHTML = `<p class="empty-row">対象期間のデータがありません</p>`;
      return;
    }

    // セル集計：rowKey -> colKey -> hours
    const cells = new Map();
    entries.forEach((entry) => {
      const r = axisOf(entry, rowAxis).key;
      const c = axisOf(entry, colAxis).key;
      const rowMap = cells.get(r) || new Map();
      rowMap.set(c, (rowMap.get(c) || 0) + entry.hours);
      cells.set(r, rowMap);
    });

    const colTotals = new Map(colCats.map((cat) => [cat.key, cat.hours]));
    const grand = sum(rowCats.map((cat) => cat.hours));
    let maxCell = 1;
    cells.forEach((rowMap) => rowMap.forEach((v) => { if (v > maxCell) maxCell = v; }));

    const head = `
      <thead>
        <tr>
          <th class="pivot-corner">${escapeHtml(AXES[rowAxis])} \\ ${escapeHtml(AXES[colAxis])}</th>
          ${colCats.map((cat) => `<th class="num">${escapeHtml(cat.label)}</th>`).join("")}
          <th class="num pivot-total-col">合計</th>
        </tr>
      </thead>`;

    const body = rowCats.map((rowCat) => {
      const rowMap = cells.get(rowCat.key) || new Map();
      const tds = colCats.map((colCat) => {
        const value = rowMap.get(colCat.key) || 0;
        if (!value) return `<td class="num pivot-cell pivot-zero">—</td>`;
        const alpha = (0.08 + 0.52 * (value / maxCell)).toFixed(3);
        return `<td class="num pivot-cell" style="background:rgba(15,118,110,${alpha})" title="${escapeHtml(rowCat.label)} × ${escapeHtml(colCat.label)}：${formatNumber(value, 1)}h">${formatNumber(value, 1)}</td>`;
      }).join("");
      return `
        <tr>
          <th scope="row" class="pivot-rowhead">${escapeHtml(rowCat.label)}</th>
          ${tds}
          <td class="num pivot-total-col">${formatNumber(rowCat.hours, 1)}</td>
        </tr>`;
    }).join("");

    const foot = `
      <tfoot>
        <tr>
          <th scope="row" class="pivot-rowhead">合計</th>
          ${colCats.map((cat) => `<td class="num pivot-total-col">${formatNumber(colTotals.get(cat.key) || 0, 1)}</td>`).join("")}
          <td class="num pivot-grand">${formatNumber(grand, 1)}</td>
        </tr>
      </tfoot>`;

    el.pivotWrap.innerHTML = `<table class="pivot-table">${head}<tbody>${body}</tbody>${foot}</table>`;
  }

  // 集計期間の月を連続生成する（データの無い月もゼロ列として含める）。
  function monthsInRange() {
    return contiguousMonths(state.startMonth, state.endMonth);
  }

  function anchorMonth() {
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const latest = state.months.length ? state.months.at(-1) : "";
    return latest && latest > current ? latest : current;
  }

  function shiftMonthStr(month, delta) {
    const [year, value] = String(month || "").split("-").map(Number);
    if (!year || !value) return month;
    const date = new Date(year, value - 1 + delta, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function contiguousMonths(start, end) {
    if (!start || !end || start > end) return start ? [start] : [];
    const result = [];
    let cursor = start;
    while (cursor <= end && result.length < 240) {
      result.push(cursor);
      cursor = shiftMonthStr(cursor, 1);
    }
    return result;
  }

  function staffLabel(code, fallbackName) {
    const person = state.staff.find((item) => item.code === code);
    const name = person ? person.name : (fallbackName || code || "(未設定)");
    return code ? `${code} ${name}` : name;
  }

  function customerLabel(code, fallbackName) {
    const master = state.customers.find((item) => item.code === code);
    const name = master ? master.name : (fallbackName || code);
    return `${code} ${name}`;
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

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add("is-visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => el.toast.classList.remove("is-visible"), 3200);
  }
})();

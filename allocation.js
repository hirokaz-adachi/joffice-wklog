/**
 * 案2 配賦エンジン（共有・ブラウザ/Node両用）。
 * design.md 第8章の正本に基づく。
 *
 * 入力: dashboard API のペイロード
 *   { staff, customers, tasks, taskPhases, customerStaff, settings, entries, billing, targets }
 * 出力: 請求月ごとの集計モデル（全社 / スタッフ別 / 顧客別、明細ブレークダウン付き）。
 *
 * 売上2系統:
 *   配賦売上(allocated)   = 工数按分 ＋ フォールバック … 金額系（帰属売上・達成率）
 *   工数対応売上(backed)  = 工数按分のみ              … per-hour 系（時間単価・生産性）
 * 売上区分(allocationType): service(役務) / excluded(対象外・立替) / tax(消費税)
 *   税抜売上(総) = service + excluded（tax は含めない）。税込 = 税抜売上 + tax。
 */
(function (global) {
  "use strict";

  function num(v) { return Number(v || 0); }
  function monthOf(dateStr) { return String(dateStr || "").slice(0, 7); }

  function shiftMonth(ym, delta) {
    const parts = String(ym || "").split("-");
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    if (!y || !m) return ym;
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  // 業務コードの正規化。数値化（先頭ゼロ落ち）とテキストの不一致を吸収し、数値コードは3桁ゼロ埋めに揃える。
  function normCode(v) {
    const s = String(v == null ? "" : v).trim();
    return /^\d+$/.test(s) ? s.padStart(3, "0") : s;
  }

  function bump(map, k1, k2, init) {
    if (!map.has(k1)) map.set(k1, new Map());
    const inner = map.get(k1);
    if (!inner.has(k2)) inner.set(k2, init());
    return inner.get(k2);
  }

  function buildIndex(data) {
    const taskByCode = new Map();
    (data.tasks || []).forEach((t) => {
      const cc = normCode(t.code);
      taskByCode.set(cc, { code: cc, name: t.name, allocationType: t.allocationType || "service" });
    });
    const phasesByCode = new Map();
    (data.taskPhases || []).forEach((p) => {
      const code = normCode(p.taskCode);
      if (!phasesByCode.has(code)) phasesByCode.set(code, []);
      phasesByCode.get(code).push({ phaseCode: p.phaseCode, ratio: num(p.ratio), sortOrder: num(p.sortOrder) });
    });
    phasesByCode.forEach((list) => list.sort((a, b) => a.sortOrder - b.sortOrder));

    const assigneesByCustomer = new Map(); // cust -> { role -> [staff] }
    const roleByCustomerStaff = new Map(); // cust -> { staff -> role }
    (data.customerStaff || []).forEach((cs) => {
      const cust = String(cs.customerCode);
      const role = String(cs.role || "");
      const sc = String(cs.staffCode);
      if (!assigneesByCustomer.has(cust)) assigneesByCustomer.set(cust, {});
      const byRole = assigneesByCustomer.get(cust);
      if (!byRole[role]) byRole[role] = [];
      byRole[role].push(sc);
      if (!roleByCustomerStaff.has(cust)) roleByCustomerStaff.set(cust, {});
      roleByCustomerStaff.get(cust)[sc] = role;
    });

    const staffName = new Map((data.staff || []).map((s) => [String(s.code), s.name]));
    const customerName = new Map((data.customers || []).map((c) => [String(c.code), c.name]));
    return { taskByCode, phasesByCode, assigneesByCustomer, roleByCustomerStaff, staffName, customerName };
  }

  function listBillingMonths(data) {
    const set = new Set();
    (data.billing || []).forEach((b) => { if (b.billingMonth) set.add(String(b.billingMonth)); });
    (data.targets || []).forEach((t) => { if (t.targetMonth) set.add(String(t.targetMonth)); });
    return [...set].sort();
  }

  function billingOffset(data) {
    return Number((data.settings || {}).billingOffset || 0);
  }

  function buildMonthModel(data, billingMonth) {
    const idx = buildIndex(data);
    const offset = billingOffset(data);
    const workMonth = shiftMonth(billingMonth, -offset);
    const warnings = [];

    const staff = new Map();
    (data.staff || []).forEach((s) => {
      staff.set(String(s.code), { code: String(s.code), name: s.name, allocated: 0, backed: 0, directHours: 0, totalHours: 0, internalHours: 0, target: 0 });
    });
    const ensureStaff = (code) => {
      const c = String(code);
      if (!staff.has(c)) staff.set(c, { code: c, name: idx.staffName.get(c) || c, allocated: 0, backed: 0, directHours: 0, totalHours: 0, internalHours: 0, target: 0 });
      return staff.get(c);
    };

    const customer = new Map();
    (data.customers || []).forEach((c) => {
      customer.set(String(c.code), { code: String(c.code), name: c.name, gross: 0, service: 0, excluded: 0, tax: 0, allocated: 0, backed: 0, hours: 0 });
    });
    const ensureCustomer = (code, name) => {
      const c = String(code);
      if (!customer.has(c)) customer.set(c, { code: c, name: name || idx.customerName.get(c) || c, gross: 0, service: 0, excluded: 0, tax: 0, allocated: 0, backed: 0, hours: 0 });
      return customer.get(c);
    };

    // 明細ブレークダウン用アキュムレータ
    const linkAB = new Map();    // staff -> cust -> {attributed, backed}
    const linkHours = new Map(); // staff -> cust -> hours
    const custItems = new Map(); // cust -> code -> {code,name,type,amount}
    function recordAB(staffCode, custCode, attributed, backed) {
      const o = bump(linkAB, String(staffCode), String(custCode), () => ({ attributed: 0, backed: 0 }));
      o.attributed += attributed; o.backed += backed;
    }

    // --- 工数集計（作業月 workMonth）---
    const hoursIndex = new Map(); // cust -> code -> phase -> Map(staff -> hours)
    (data.entries || []).forEach((e) => {
      if (monthOf(e.date) !== workMonth) return;
      const hours = num(e.hours);
      const st = ensureStaff(e.staffCode);
      st.totalHours += hours;
      if (e.customerCode) {
        st.directHours += hours;
        const cust = String(e.customerCode);
        const code = normCode(e.taskCode);
        const phase = String(e.phaseCode || "");
        ensureCustomer(e.customerCode, e.customer).hours += hours;
        if (!hoursIndex.has(cust)) hoursIndex.set(cust, new Map());
        const byTask = hoursIndex.get(cust);
        if (!byTask.has(code)) byTask.set(code, new Map());
        const phMap = byTask.get(code);
        if (!phMap.has(phase)) phMap.set(phase, new Map());
        const byStaff = phMap.get(phase);
        byStaff.set(String(e.staffCode), num(byStaff.get(String(e.staffCode))) + hours);
        // linkHours
        if (!linkHours.has(String(e.staffCode))) linkHours.set(String(e.staffCode), new Map());
        const lh = linkHours.get(String(e.staffCode));
        lh.set(cust, num(lh.get(cust)) + hours);
      } else {
        st.internalHours += hours;
      }
    });

    // --- 目標（請求月 billingMonth）---
    (data.targets || []).forEach((t) => {
      if (String(t.targetMonth) !== billingMonth) return;
      const st = staff.get(String(t.staffCode));
      if (st) st.target += num(t.targetAmount);
    });

    const firm = { gross: 0, service: 0, excluded: 0, tax: 0, allocated: 0, backed: 0, unallocated: 0 };

    function allocByHours(pool, byStaff, cust) {
      let sum = 0;
      byStaff.forEach((h) => { sum += h; });
      if (sum <= 0) return false;
      byStaff.forEach((h, staffCode) => {
        const share = pool * (h / sum);
        const st = ensureStaff(staffCode);
        st.allocated += share; st.backed += share;
        cust.allocated += share; cust.backed += share;
        firm.allocated += share; firm.backed += share;
        recordAB(staffCode, cust.code, share, share);
      });
      return true;
    }

    function allocFallback(pool, custCode, roleCodes, cust, label) {
      const byRole = idx.assigneesByCustomer.get(String(custCode)) || {};
      let targets = [];
      roleCodes.forEach((rc) => { targets = targets.concat(byRole[rc] || []); });
      targets = [...new Set(targets)];
      if (!targets.length) {
        firm.unallocated += pool;
        warnings.push("担当者未設定でフォールバック不可: 顧客 " + custCode + " / " + label);
        return;
      }
      const share = pool / targets.length;
      targets.forEach((staffCode) => {
        const st = ensureStaff(staffCode);
        st.allocated += share; cust.allocated += share; firm.allocated += share;
        recordAB(staffCode, cust.code, share, 0);
      });
    }

    // --- 請求（請求月 billingMonth）を配賦 ---
    (data.billing || []).forEach((b) => {
      if (String(b.billingMonth) !== billingMonth) return;
      const net = num(b.netAmount);
      const code = normCode(b.invoiceItemCode);
      const cust = ensureCustomer(b.customerCode, b.customer);
      const task = idx.taskByCode.get(code);
      const type = task ? task.allocationType : "service";

      const itemRec = bump(custItems, String(cust.code), code, () => ({ code: code, name: (task ? task.name : (b.invoiceItem || code)), type: type, amount: 0 }));
      itemRec.amount += net;

      if (type === "tax") { cust.tax += net; firm.tax += net; return; }
      cust.gross += net; firm.gross += net;
      if (type === "excluded") { cust.excluded += net; firm.excluded += net; return; }
      cust.service += net; firm.service += net;
      if (!task) warnings.push("業務コード未マッピング（役務として暫定配賦）: " + code + " / 顧客 " + cust.code);

      const phases = idx.phasesByCode.get(code);
      const byTaskHours = (hoursIndex.get(String(cust.code)) || new Map()).get(code) || new Map();

      if (phases && phases.length) {
        const ratioSum = phases.reduce((a, p) => a + p.ratio, 0);
        if (Math.abs(ratioSum - 100) > 0.01) warnings.push("工程振分率合計≠100: " + code + " (" + ratioSum + ")");
        phases.forEach((p) => {
          if (p.ratio <= 0) return;
          const pool = net * (p.ratio / 100);
          const byStaff = byTaskHours.get(String(p.phaseCode)) || new Map();
          if (!allocByHours(pool, byStaff, cust)) {
            allocFallback(pool, cust.code, [p.phaseCode], cust, code + ":" + p.phaseCode);
          }
        });
      } else {
        let merged = new Map();
        byTaskHours.forEach((byStaff) => byStaff.forEach((h, sc) => merged.set(sc, num(merged.get(sc)) + h)));
        if (!allocByHours(net, merged, cust)) {
          allocFallback(net, cust.code, ["PRE", "REV"], cust, code + ":whole");
        }
      }
    });

    // 顧客→スタッフ の逆引き（明細用）
    const custStaff = new Map(); // cust -> staff -> {attributed,backed,hours}
    linkAB.forEach((inner, sc) => inner.forEach((v, cc) => {
      const o = bump(custStaff, cc, sc, () => ({ attributed: 0, backed: 0, hours: 0 }));
      o.attributed += v.attributed; o.backed += v.backed;
    }));
    linkHours.forEach((inner, sc) => inner.forEach((h, cc) => {
      const o = bump(custStaff, cc, sc, () => ({ attributed: 0, backed: 0, hours: 0 }));
      o.hours += h;
    }));

    // --- スタッフ別 ---
    const staffList = [...staff.values()].map((s) => {
      const ab = linkAB.get(s.code) || new Map();
      const lh = linkHours.get(s.code) || new Map();
      const codes = new Set([...ab.keys(), ...lh.keys()]);
      const customers = [];
      codes.forEach((cc) => {
        const v = ab.get(cc) || { attributed: 0, backed: 0 };
        const h = num(lh.get(cc));
        customers.push({
          code: cc, name: idx.customerName.get(cc) || cc,
          attributed: v.attributed, backed: v.backed, hours: h,
          rate: h ? v.backed / h : null
        });
      });
      customers.sort((a, b) => b.attributed - a.attributed);
      return {
        code: s.code, name: s.name,
        attributedRevenue: s.allocated, backedRevenue: s.backed, target: s.target,
        achievement: s.target ? s.allocated / s.target : 0,
        directHours: s.directHours, totalHours: s.totalHours, internalHours: s.internalHours,
        directRate: s.directHours ? s.backed / s.directHours : 0,
        productivity: s.totalHours ? s.backed / s.totalHours : 0,
        directRatio: s.totalHours ? s.directHours / s.totalHours : 0,
        customers: customers
      };
    });

    // --- 顧客別 ---
    const customerList = [...customer.values()]
      .filter((c) => c.gross > 0 || c.tax > 0 || c.hours > 0)
      .map((c) => {
        const items = [...(custItems.get(c.code) || new Map()).values()].sort((a, b) => b.amount - a.amount);
        const roleMap = idx.roleByCustomerStaff.get(c.code) || {};
        const sbMap = custStaff.get(c.code) || new Map();
        const staffBreakdown = [...sbMap.entries()].map(([sc, v]) => ({
          staffCode: sc, name: idx.staffName.get(sc) || sc, role: roleMap[sc] || "",
          attributed: v.attributed, backed: v.backed, hours: v.hours,
          rate: v.hours ? v.backed / v.hours : null
        })).sort((a, b) => b.attributed - a.attributed);
        return {
          code: c.code, name: c.name,
          grossRevenue: c.gross, serviceRevenue: c.service, excludedRevenue: c.excluded, tax: c.tax,
          backedRevenue: c.backed, unrecordedRevenue: c.service - c.backed, hours: c.hours,
          rate: c.hours ? c.backed / c.hours : null,
          primaryStaff: primaryStaffOf(idx, c.code),
          invoiceItems: items, staffBreakdown: staffBreakdown
        };
      });

    const targetTotal = staffList.reduce((a, s) => a + s.target, 0);
    const firmModel = {
      billingMonth: billingMonth, workMonth: workMonth, offset: offset,
      grossRevenue: firm.gross, serviceRevenue: firm.service, excludedRevenue: firm.excluded,
      tax: firm.tax, taxIncluded: firm.gross + firm.tax,
      backedRevenue: firm.backed, unallocated: firm.unallocated,
      targetTotal: targetTotal, achievement: targetTotal ? firm.service / targetTotal : 0,
      directHours: staffList.reduce((a, s) => a + s.directHours, 0),
      totalHours: staffList.reduce((a, s) => a + s.totalHours, 0),
      avgCustomerRate: 0
    };
    firmModel.avgCustomerRate = firmModel.directHours ? firmModel.backedRevenue / firmModel.directHours : 0;

    return { firm: firmModel, staff: staffList, customers: customerList, warnings: warnings };
  }

  function primaryStaffOf(idx, custCode) {
    const byRole = idx.assigneesByCustomer.get(String(custCode)) || {};
    const order = ["PRE", "REV"];
    const names = [];
    order.forEach((rc) => (byRole[rc] || []).forEach((sc) => names.push((idx.staffName.get(sc) || sc) + "(" + rc + ")")));
    Object.keys(byRole).forEach((rc) => {
      if (order.indexOf(rc) < 0) (byRole[rc] || []).forEach((sc) => names.push((idx.staffName.get(sc) || sc) + "(" + rc + ")"));
    });
    return names.join(" / ") || "—";
  }

  const api = { buildMonthModel, listBillingMonths, shiftMonth, billingOffset };
  global.JOfficeAllocation = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

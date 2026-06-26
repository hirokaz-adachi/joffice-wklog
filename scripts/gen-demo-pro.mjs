/**
 * pro(PHP+MySQL)環境向け デモデータ生成 → INSERT文(SQL)を出力。
 *
 * 方針（2026-06-26 合意・工数調整版）:
 *  - スタッフ = pro 実名簿 9名（JA001/JM001-2/JS001-6）。全員に工数・目標・担当を付与。
 *  - 顧客 = 匿名40社（GASのコード体系0001-0043を保持・社名はダミー・PIIなし）。
 *  - 期間 = 直近12か月（2025-07〜2026-06）。
 *  - 請求 = すべて口座振替（請求書払いは請求書発行機能の実装時に別途生成）。
 *  - 工数（調整）:
 *      * 1名1営業日 ≈ 7時間（JA001のみ ≈ 10時間）。土日は工数なし。
 *      * 社内工数（非生産）は1名あたり総工数の20%以内（JA001のみ約30%）。
 *      * 生産工数は担当顧客の役務（PRE/REV）へ作業標準の比重で按分し、日次≈目標へ配置。
 *  - 季節性（算定基礎7月/賞与7・12月/年末調整12月/給報1月/労働保険・住民税6月）。
 *  - 目標 = 各スタッフの帰属売上から達成率90〜110%域へ較正。
 *  - 乱数不使用（index/月ベースの決定論）。再生成で冪等。
 *
 * 使い方: node scripts/gen-demo-pro.mjs [出力先.sql]
 */
import { writeFileSync } from "node:fs";

// ---- スタッフ（センサス実値） ----
const STAFF = [
  ["JA001", "管理者"], ["JM001", "マネージャ１"], ["JM002", "マネージャ２"],
  ["JS001", "スタッフ１"], ["JS002", "スタッフ２"], ["JS003", "スタッフ３"],
  ["JS004", "スタッフ４"], ["JS005", "スタッフ５"], ["JS006", "スタッフ６"],
];
const NS = STAFF.length;

// ---- 業務区分カタログ [code, name, type, pre%, rev%] ----
const CATALOG = [
  ["001", "労務相談",            "service",  100, 0],
  ["002", "事務長代行費用",      "service",  100, 0],
  ["003", "有給休暇管理費用",    "service",  70, 30],
  ["026", "給与計算",            "service",  70, 30],
  ["027", "FBデータ作成費用",    "excluded", 0,  0],
  ["028", "マイナンバー管理料金","excluded", 0,  0],
  ["036", "スポット手続",        "service",  100, 0],
  ["056", "賞与計算",            "service",  70, 30],
  ["060", "諸費用",              "excluded", 0,  0],
  ["061", "給与支払報告書",      "service",  70, 30],
  ["062", "算定基礎届",          "service",  70, 30],
  ["063", "労働保険年度更新",    "service",  70, 30],
  ["064", "住民税変更",          "service",  70, 30],
  ["065", "年末調整",            "service",  70, 30],
  ["080", "消費税",              "tax",      0,  0],
];
const nameOf = (c) => (CATALOG.find((x) => x[0] === c) || [, c])[1];
const preR = (c) => (CATALOG.find((x) => x[0] === c) || [, , , 0])[3];
const revR = (c) => (CATALOG.find((x) => x[0] === c) || [, , , , 0])[4];

// 作業標準時間（按分の比重）[pre, rev]
const STD_HOURS = {
  "001": [1.0, 0],   "002": [3.0, 0],  "003": [0.75, 0.25],
  "026": [3.0, 0.75],"036": [2.0, 0],  "056": [3.0, 0.75],
  "061": [1.5, 0.5], "062": [4.0, 1.0],"063": [3.0, 1.0],
  "064": [1.5, 0],   "065": [6.0, 1.5],
};

// ---- 顧客40社（GASコード体系を保持・社名は匿名ダミー・全件口座振替） ----
const CUST_CODES = [
  "0001","0002","0003","0004","0005","0006","0007","0009","0010","0011",
  "0012","0013","0015","0016","0018","0019","0020","0021","0022","0023",
  "0024","0025","0026","0027","0028","0029","0030","0031","0032","0033",
  "0034","0035","0036","0037","0038","0039","0040","0041","0042","0043",
];
const TYPES = [
  (n) => `サンプルクリニック${n}`,
  (n) => `デモ内科医院${n}`,
  (n) => `医療法人デモ会${n}`,
  (n) => `株式会社デモ${n}`,
  (n) => `デモ歯科医院${n}`,
  (n) => `合同会社サンプル${n}`,
  (n) => `デモ皮膚科クリニック${n}`,
  (n) => `一般社団法人サンプル${n}`,
];
const CUSTOMERS = CUST_CODES.map((code, i) => ({
  code, name: TYPES[i % TYPES.length](String(i + 1).padStart(2, "0")),
  paymentMethod: "transfer", idx: i, // 当面すべて口座振替
}));
const custName = (code) => (CUSTOMERS.find((c) => c.code === code) || {}).name || code;

// ---- 期間（直近12か月） ----
const MONTHS = (() => {
  const out = []; let y = 2025, m = 7;
  for (let k = 0; k < 12; k += 1) { out.push(`${y}-${String(m).padStart(2, "0")}`); m += 1; if (m > 12) { m = 1; y += 1; } }
  return out;
})();

// ---- 担当（PRE/REVを巡回）＋時系列の担当交代 ----
const preBase = (i) => STAFF[i % NS][0];
const revBase = (i) => STAFF[(i + 4) % NS][0];
const ASSIGN_CHANGES = [
  [0, "PRE", "2025-11", "JS003"],
  [5, "REV", "2026-01", "JM002"],
  [12, "PRE", "2026-03", "JS005"],
  [20, "PRE", "2025-10", "JM001"],
  [33, "REV", "2026-02", "JS001"],
];
function preAsOf(i, month) { let s = preBase(i); for (const [ci, role, fm, ns] of ASSIGN_CHANGES) if (ci === i && role === "PRE" && month >= fm) s = ns; return s; }
function revAsOf(i, month) { let s = revBase(i); for (const [ci, role, fm, ns] of ASSIGN_CHANGES) if (ci === i && role === "REV" && month >= fm) s = ns; return s; }

// 顧客サイズ係数（給与計算ベース額3万〜8.2万）
function payrollOf(i) { const v = 30000 + ((i * 7) % 13) * 4000 + (i % 3) * 2000; return Math.round(v / 1000) * 1000; }
const sizeFactor = (i) => 0.7 + ((i % 8) * 0.1);

function recurring(i) {
  const out = [];
  if (i % 3 === 0) out.push(["001", 22000]);
  if (i % 5 === 0) out.push(["002", 55000]);
  if (i % 4 === 1) out.push(["003", 25000]);
  if (i % 6 === 2) out.push(["036", 40000]);
  return out;
}
function seasonal(i, month) {
  const mm = month.slice(5, 7); const out = [];
  if (mm === "07") { out.push(["062", 16000 + (i % 5) * 2000]); if (i % 2 === 0) out.push(["056", 38000]); }
  if (mm === "12") { out.push(["065", 30000 + (i % 6) * 8000]); if (i % 2 === 1) out.push(["056", 40000]); }
  if (mm === "01") { out.push(["061", 12000]); }
  if (mm === "06") { out.push(["063", 12000]); if (i % 3 === 0) out.push(["064", 8000]); }
  return out;
}
function excluded(i) {
  const out = [];
  if (i % 2 === 0) out.push(["060", 2000]);
  if (i % 4 === 0) out.push(["027", 5000]);
  if (i % 6 === 0) out.push(["028", 3000]);
  return out;
}
function weekdays(month) {
  const y = +month.slice(0, 4), mo = +month.slice(5, 7);
  const last = new Date(y, mo, 0).getDate(); const days = [];
  for (let d = 1; d <= last; d += 1) { const dow = new Date(y, mo - 1, d).getDay(); if (dow !== 0 && dow !== 6) days.push(`${month}-${String(d).padStart(2, "0")}`); }
  return days;
}
const qh = (x) => Math.max(0, Math.round(x * 4) / 4);
const transferOf = (m) => { const y = +m.slice(0, 4), mo = +m.slice(5, 7); const ny = mo === 12 ? y + 1 : y, nm = mo === 12 ? 1 : mo + 1; return `${ny}-${String(nm).padStart(2, "0")}-22`; };
const esc = (s) => String(s == null ? "" : s).replace(/'/g, "''");

// ====================== 生成 ======================
const billing = [], worklogs = [], custStaff = [], targets = [];
let wseq = 0; const wid = () => `w${String(++wseq).padStart(6, "0")}`;

// 担当（baseline + 交代）
CUSTOMERS.forEach((c, i) => {
  custStaff.push({ customerCode: c.code, role: "PRE", staffCode: preBase(i), effectiveFrom: "", sortOrder: 1 });
  custStaff.push({ customerCode: c.code, role: "REV", staffCode: revBase(i), effectiveFrom: "", sortOrder: 2 });
});
ASSIGN_CHANGES.forEach(([ci, role, fm, ns]) => custStaff.push({ customerCode: CUSTOMERS[ci].code, role, staffCode: ns, effectiveFrom: fm, sortOrder: role === "PRE" ? 1 : 2 }));

// 請求＋帰属売上＋スタッフ別の作業アイテム（工数按分用）を収集
const attr = {};                 // staff|month -> 帰属売上
const staffItems = {};           // staff|month -> [{customerCode, code, phase, weight}]
const addAttr = (s, m, v) => { const k = `${s}|${m}`; attr[k] = (attr[k] || 0) + v; };
const pushItem = (s, m, it) => { const k = `${s}|${m}`; (staffItems[k] = staffItems[k] || []).push(it); };

function billRow(month, c, code, net, transfer, taxAmt) {
  return {
    invoiceId: `b_${month}_${c.code}_${code}`, billingMonth: month, customerCode: c.code, customer: c.name,
    invoiceItemCode: code, invoiceItem: nameOf(code), paymentMethod: "口座振替", source: "csv",
    netAmount: net, taxAmount: taxAmt || 0, grossAmount: net, transferDate: transfer,
  };
}

MONTHS.forEach((month) => {
  const transfer = transferOf(month);
  CUSTOMERS.forEach((c, ci) => {
    const pre = preAsOf(ci, month), rev = revAsOf(ci, month), sf = sizeFactor(ci);
    const services = [["026", payrollOf(ci)], ...recurring(ci), ...seasonal(ci, month)];
    let taxable = 0;
    services.forEach(([code, net]) => {
      taxable += net;
      billing.push(billRow(month, c, code, net, transfer));
      if (preR(code) > 0) { addAttr(pre, month, Math.round(net * preR(code) / 100)); const w = (STD_HOURS[code] ? STD_HOURS[code][0] : 0.5) * sf; if (w > 0) pushItem(pre, month, { customerCode: c.code, code, phase: "PRE", weight: w }); }
      if (revR(code) > 0) { addAttr(rev, month, Math.round(net * revR(code) / 100)); const w = (STD_HOURS[code] ? STD_HOURS[code][1] : 0) * sf; if (w > 0) pushItem(rev, month, { customerCode: c.code, code, phase: "REV", weight: w }); }
    });
    excluded(ci).forEach(([code, net]) => { taxable += net; billing.push(billRow(month, c, code, net, transfer)); });
    const tax = Math.round(taxable * 0.10);
    if (tax > 0) billing.push(billRow(month, c, "080", tax, transfer, tax));
  });
});

// 工数：トップダウン（月目標＝日次×営業日 → 社内比率を確保 → 残りを担当役務へ按分・日次≈目標で配置）
const MAXPIECE = 3.5;
function splitInto(total, max) { const out = []; let r = qh(total); while (r > max + 0.001) { out.push(max); r = qh(r - max); } if (r >= 0.25) out.push(r); return out; }

MONTHS.forEach((month) => {
  const wd = weekdays(month), nW = wd.length, mm = +month.slice(5, 7);
  STAFF.forEach((s, si) => {
    const code = s[0], isJA = code === "JA001";
    const daily = isJA ? 10 : 7;
    const total = daily * nW;                                  // 月の目標総工数
    const ratio = isJA ? 0.28 : (0.13 + (si % 4) * 0.015);      // 社内比率（JA≈28%/他13-17.5%）
    const internalH = qh(total * ratio);
    const productiveH = total - internalH;

    const items = (staffItems[`${code}|${month}`] || []);
    const sumW = items.reduce((a, it) => a + it.weight, 0) || 1;
    // 生産工数の小片
    const prodPieces = [];
    items.forEach((it) => { const h = productiveH * it.weight / sumW; splitInto(h, MAXPIECE).forEach((ph) => prodPieces.push({ ...it, h: ph })); });
    // 社内工数の小片
    const intPieces = splitInto(internalH, 3).map((h) => ({ internal: true, h }));
    // 社内を生産の間に均等挿入
    const pieces = [];
    const step = intPieces.length ? Math.max(1, Math.floor(prodPieces.length / (intPieces.length + 1))) : 0;
    let ii = 0;
    prodPieces.forEach((p, k) => { pieces.push(p); if (intPieces.length && step && (k + 1) % step === 0 && ii < intPieces.length) pieces.push(intPieces[ii++]); });
    while (ii < intPieces.length) pieces.push(intPieces[ii++]);

    // 日次≈daily で平日へ配置（追加で目標を超過しそうなら先に翌日へ送る＝1日を目標付近に均す）
    let di = 0, acc = 0;
    pieces.forEach((p) => {
      if (acc > 0 && acc + p.h > daily + 0.5 && di < nW - 1) { di += 1; acc = 0; }
      const date = wd[di]; acc += p.h;
      if (p.internal) {
        worklogs.push({ id: wid(), date, staffCode: code, customerCode: "", taskCode: "", phaseCode: "", taskType: "社内/その他", hours: p.h, memo: `${mm}月 社内業務・打合せ・自己研鑽` });
      } else {
        worklogs.push({ id: wid(), date, staffCode: code, customerCode: p.customerCode, taskCode: p.code, phaseCode: p.phase, taskType: nameOf(p.code), hours: p.h, memo: `${mm}月分 ${nameOf(p.code)}（${p.phase === "PRE" ? "Prepare" : "Review"}） ${custName(p.customerCode)}` });
      }
    });
  });
});

// 目標（帰属売上から達成率90〜110%域へ較正）
MONTHS.forEach((month) => {
  const mi = MONTHS.indexOf(month);
  STAFF.forEach((s, si) => {
    const a = attr[`${s[0]}|${month}`] || 0;
    const desired = 0.90 + (((si * 3 + mi * 5) % 21) / 100);
    targets.push({ targetMonth: month, staffCode: s[0], targetAmount: Math.max(50000, Math.round((a / desired) / 10000) * 10000) });
  });
});

// ====================== SQL 出力 ======================
function batchInsert(table, cols, rows, toVals) {
  if (!rows.length) return "";
  const out = []; const SIZE = 200;
  for (let i = 0; i < rows.length; i += SIZE) {
    const chunk = rows.slice(i, i + SIZE).map((r) => `(${toVals(r)})`).join(",\n  ");
    out.push(`INSERT INTO ${table} (${cols.join(", ")}) VALUES\n  ${chunk};`);
  }
  return out.join("\n");
}

const sql = [];
sql.push("-- pro デモデータ（自動生成・gen-demo-pro.mjs・工数調整版）");
sql.push("SET NAMES utf8mb4;");
sql.push("-- クリア（マスタ=staff/users/task は保持）");
sql.push("DELETE FROM jo_worklogs;");
sql.push("DELETE FROM jo_billings;");
sql.push("DELETE FROM jo_customer_staff;");
sql.push("DELETE FROM jo_staff_targets;");
sql.push("DELETE FROM jo_customers;");
sql.push(batchInsert("jo_customers", ["code", "name", "paymentMethod", "honorific", "sortOrder", "isActive", "updatedAt"], CUSTOMERS,
  (c) => `'${esc(c.code)}','${esc(c.name)}','${c.paymentMethod}','御中',${c.idx + 1},1,NOW()`));
sql.push(batchInsert("jo_customer_staff", ["customerCode", "role", "staffCode", "effectiveFrom", "sortOrder", "updatedAt"], custStaff,
  (r) => `'${esc(r.customerCode)}','${r.role}','${esc(r.staffCode)}','${esc(r.effectiveFrom)}',${r.sortOrder},NOW()`));
sql.push(batchInsert("jo_staff_targets", ["targetMonth", "staffCode", "targetAmount", "updatedAt"], targets,
  (r) => `'${r.targetMonth}','${esc(r.staffCode)}',${r.targetAmount},NOW()`));
sql.push(batchInsert("jo_billings", ["invoiceId", "billingMonth", "customerCode", "customer", "invoiceItemCode", "invoiceItem", "paymentMethod", "source", "netAmount", "taxAmount", "grossAmount", "transferDate", "updatedAt"], billing,
  (r) => `'${esc(r.invoiceId)}','${r.billingMonth}','${esc(r.customerCode)}','${esc(r.customer)}','${esc(r.invoiceItemCode)}','${esc(r.invoiceItem)}','${esc(r.paymentMethod)}','${r.source}',${r.netAmount},${r.taxAmount},${r.grossAmount},${r.transferDate ? `'${r.transferDate}'` : "NULL"},NOW()`));
sql.push(batchInsert("jo_worklogs", ["id", "date", "staffCode", "customerCode", "taskCode", "phaseCode", "taskType", "hours", "memo", "updatedAt"], worklogs,
  (r) => `'${esc(r.id)}','${r.date}','${esc(r.staffCode)}',${r.customerCode ? `'${esc(r.customerCode)}'` : "NULL"},${r.taskCode ? `'${esc(r.taskCode)}'` : "NULL"},${r.phaseCode ? `'${esc(r.phaseCode)}'` : "NULL"},'${esc(r.taskType)}',${r.hours},'${esc(r.memo)}',NOW()`));

const outPath = process.argv[2] || "demo_pro.sql";
writeFileSync(outPath, sql.join("\n") + "\n", "utf8");

// ====================== 統計（検算） ======================
const totalNet = billing.filter((b) => b.invoiceItemCode !== "080").reduce((s, b) => s + b.netAmount, 0);
const byMonth = {}; billing.forEach((b) => { if (b.invoiceItemCode !== "080") byMonth[b.billingMonth] = (byMonth[b.billingMonth] || 0) + b.netAmount; });
// スタッフ別：総工数/社内比率/日次平均
const tot = {}, intl = {}, days = {};
worklogs.forEach((w) => {
  const k = `${w.staffCode}|${w.date.slice(0, 7)}`;
  tot[k] = (tot[k] || 0) + w.hours;
  if (!w.customerCode) intl[k] = (intl[k] || 0) + w.hours;
  (days[k] = days[k] || new Set()).add(w.date);
});
const perStaff = STAFF.map((s) => {
  const code = s[0];
  let T = 0, I = 0, D = 0, n = 0;
  MONTHS.forEach((m) => { const k = `${code}|${m}`; if (tot[k]) { T += tot[k]; I += (intl[k] || 0); D += tot[k] / (days[k] ? days[k].size : 1); n += 1; } });
  return { code, avgMonthlyH: Math.round(T / n * 10) / 10, internalPct: Math.round(I / T * 1000) / 10, avgDailyH: Math.round(D / n * 10) / 10 };
});
console.log(JSON.stringify({
  rows: { customers: CUSTOMERS.length, customerStaff: custStaff.length, targets: targets.length, billing: billing.length, worklogs: worklogs.length },
  monthlyNet: byMonth, totalNet,
  perStaff, outPath,
}, null, 2));

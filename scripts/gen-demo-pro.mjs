/**
 * pro(PHP+MySQL)環境向け デモデータ生成 → INSERT文(SQL)を出力。
 *
 * 方針（2026-06-26 合意）:
 *  - スタッフ = pro 実名簿 9名（JA001/JM001-2/JS001-6）。全員に工数・目標・担当を付与。
 *  - 顧客 = 匿名40社（GASのコード体系0001-0043を保持・社名はダミー・PIIなし）。
 *  - 期間 = 直近12か月（2025-07〜2026-06）。
 *  - 季節性：算定基礎(7月)・賞与(7,12月)・年末調整(12月)・給与支払報告書(1月)・
 *            労働保険年度更新(6月)・住民税変更(6月)。
 *  - 工数 = 作業標準時間ベース（請求額から逆算しない＝時間単価に妥当な分散）。
 *           各スタッフ月150h前後＋繁忙月は増、内部工数で補填、上限~175h。
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

// 作業標準時間（1回あたり・size係数で微調整）[pre, rev]
const STD_HOURS = {
  "001": [1.0, 0],   "002": [3.0, 0],  "003": [0.75, 0.25],
  "026": [3.0, 0.75],"036": [2.0, 0],  "056": [3.0, 0.75],
  "061": [1.5, 0.5], "062": [4.0, 1.0],"063": [3.0, 1.0],
  "064": [1.5, 0],   "065": [6.0, 1.5],
};

// ---- 顧客40社（GASコード体系を保持・社名は匿名ダミー） ----
const CUST_CODES = [
  "0001","0002","0003","0004","0005","0006","0007","0009","0010","0011",
  "0012","0013","0015","0016","0018","0019","0020","0021","0022","0023",
  "0024","0025","0026","0027","0028","0029","0030","0031","0032","0033",
  "0034","0035","0036","0037","0038","0039","0040","0041","0042","0043",
];
// 匿名社名のタイプ（医療系/法人系を織り交ぜ・明らかにダミー）
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
const CUSTOMERS = CUST_CODES.map((code, i) => {
  const n2 = String(i + 1).padStart(2, "0");
  const name = TYPES[i % TYPES.length](n2);
  const paymentMethod = (i % 5 === 0) ? "invoice" : "transfer"; // 2割を請求書払い
  return { code, name, paymentMethod, idx: i };
});

// ---- 期間（直近12か月） ----
const MONTHS = (() => {
  const out = [];
  let y = 2025, m = 7;
  for (let k = 0; k < 12; k += 1) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
})();

// ---- 担当（PRE/REVを巡回）＋時系列の担当交代 ----
const preBase = (i) => STAFF[i % NS][0];
const revBase = (i) => STAFF[(i + 4) % NS][0];
// 期中の担当交代（時系列デモ）: [custIdx, role, fromMonth, newStaffCode]
const ASSIGN_CHANGES = [
  [0, "PRE", "2025-11", "JS003"],
  [5, "REV", "2026-01", "JM002"],
  [12, "PRE", "2026-03", "JS005"],
  [20, "PRE", "2025-10", "JM001"],
  [33, "REV", "2026-02", "JS001"],
];
function preAsOf(i, month) {
  let s = preBase(i);
  for (const [ci, role, fm, ns] of ASSIGN_CHANGES) if (ci === i && role === "PRE" && month >= fm) s = ns;
  return s;
}
function revAsOf(i, month) {
  let s = revBase(i);
  for (const [ci, role, fm, ns] of ASSIGN_CHANGES) if (ci === i && role === "REV" && month >= fm) s = ns;
  return s;
}

// 顧客サイズ係数（給与計算ベース額3万〜8.2万）
function payrollOf(i) {
  const v = 30000 + ((i * 7) % 13) * 4000 + (i % 3) * 2000;
  return Math.round(v / 1000) * 1000;
}
const sizeFactor = (i) => 0.7 + ((i % 8) * 0.1); // 0.7〜1.4

// 毎月の固定役務（顧問契約系）
function recurring(i) {
  const out = [];
  if (i % 3 === 0) out.push(["001", 22000]);
  if (i % 5 === 0) out.push(["002", 55000]);
  if (i % 4 === 1) out.push(["003", 25000]);
  if (i % 6 === 2) out.push(["036", 40000]);
  return out;
}
// 季節役務（月別）
function seasonal(i, month) {
  const mm = month.slice(5, 7);
  const out = [];
  if (mm === "07") { out.push(["062", 16000 + (i % 5) * 2000]); if (i % 2 === 0) out.push(["056", 38000]); } // 算定基礎・夏賞与
  if (mm === "12") { out.push(["065", 30000 + (i % 6) * 8000]); if (i % 2 === 1) out.push(["056", 40000]); } // 年末調整・冬賞与
  if (mm === "01") { out.push(["061", 12000]); }                                                            // 給与支払報告書
  if (mm === "06") { out.push(["063", 12000]); if (i % 3 === 0) out.push(["064", 8000]); }                   // 労働保険年度更新・住民税変更
  return out;
}
// 配賦対象外（立替・手数料）
function excluded(i) {
  const out = [];
  if (i % 2 === 0) out.push(["060", 2000]);
  if (i % 4 === 0) out.push(["027", 5000]);
  if (i % 6 === 0) out.push(["028", 3000]);
  return out;
}

// 月の平日一覧
function weekdays(month) {
  const y = +month.slice(0, 4), mo = +month.slice(5, 7);
  const last = new Date(y, mo, 0).getDate();
  const days = [];
  for (let d = 1; d <= last; d += 1) {
    const dow = new Date(y, mo - 1, d).getDay();
    if (dow !== 0 && dow !== 6) days.push(`${month}-${String(d).padStart(2, "0")}`);
  }
  return days;
}
const qh = (x) => Math.max(0.25, Math.round(x * 4) / 4);
const transferOf = (m) => {
  const y = +m.slice(0, 4), mo = +m.slice(5, 7);
  const ny = mo === 12 ? y + 1 : y, nm = mo === 12 ? 1 : mo + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-22`;
};
const esc = (s) => String(s == null ? "" : s).replace(/'/g, "''");

// ====================== 生成 ======================
const billing = [];   // jo_billings
const worklogs = [];   // jo_worklogs
const custStaff = [];  // jo_customer_staff
const targets = [];    // jo_staff_targets
let wseq = 0;
const wid = () => `w${String(++wseq).padStart(6, "0")}`;

// 担当（baseline + 交代）
CUSTOMERS.forEach((c, i) => {
  custStaff.push({ customerCode: c.code, role: "PRE", staffCode: preBase(i), effectiveFrom: "", sortOrder: 1 });
  custStaff.push({ customerCode: c.code, role: "REV", staffCode: revBase(i), effectiveFrom: "", sortOrder: 2 });
});
ASSIGN_CHANGES.forEach(([ci, role, fm, ns]) => {
  custStaff.push({ customerCode: CUSTOMERS[ci].code, role, staffCode: ns, effectiveFrom: fm, sortOrder: role === "PRE" ? 1 : 2 });
});

// 帰属売上（スタッフ×月）と生産工数（スタッフ×月）を集計
const attr = {};   // key staff|month -> 帰属売上
const prod = {};   // key staff|month -> 生産工数h
const addAttr = (s, m, v) => { const k = `${s}|${m}`; attr[k] = (attr[k] || 0) + v; };
const addProd = (s, m, v) => { const k = `${s}|${m}`; prod[k] = (prod[k] || 0) + v; };

MONTHS.forEach((month) => {
  const wd = weekdays(month);
  const transfer = transferOf(month);

  CUSTOMERS.forEach((c, ci) => {
    const pre = preAsOf(ci, month), rev = revAsOf(ci, month);
    const sf = sizeFactor(ci);
    const services = [["026", payrollOf(ci)], ...recurring(ci), ...seasonal(ci, month)];
    let taxable = 0;
    const memoCust = c.name;

    services.forEach((it, idx) => {
      const [code, net] = it;
      taxable += net;
      // 請求（射影）
      billing.push({
        invoiceId: `b_${month}_${c.code}_${code}`, billingMonth: month, customerCode: c.code, customer: c.name,
        invoiceItemCode: code, invoiceItem: nameOf(code),
        paymentMethod: c.paymentMethod === "invoice" ? "請求書払い" : "口座振替",
        source: c.paymentMethod === "invoice" ? "manual" : "csv",
        netAmount: net, taxAmount: 0, grossAmount: net,
        transferDate: c.paymentMethod === "invoice" ? "" : transfer,
      });
      // 帰属売上（PRE/REV比で配賦）
      if (preR(code) > 0) addAttr(pre, month, Math.round(net * preR(code) / 100));
      if (revR(code) > 0) addAttr(rev, month, Math.round(net * revR(code) / 100));
      // 工数（作業標準×size）
      const std = STD_HOURS[code];
      if (std) {
        const d1 = wd[(ci * 3 + idx * 5) % wd.length];
        const hPre = qh(std[0] * sf);
        if (hPre > 0) { worklogs.push(wl(d1, pre, c.code, code, "PRE", hPre, `${+month.slice(5,7)}月分 ${nameOf(code)}（Prepare） ${memoCust}`)); addProd(pre, month, hPre); }
        if (std[1] > 0) {
          const d2 = wd[(ci * 3 + idx * 5 + 2) % wd.length];
          const hRev = qh(std[1] * sf);
          worklogs.push(wl(d2, rev, c.code, code, "REV", hRev, `${+month.slice(5,7)}月分 ${nameOf(code)}（Review） ${memoCust}`)); addProd(rev, month, hRev);
        }
      }
    });

    // 配賦対象外（請求のみ）
    excluded(ci).forEach(([code, net]) => {
      taxable += net;
      billing.push({
        invoiceId: `b_${month}_${c.code}_${code}`, billingMonth: month, customerCode: c.code, customer: c.name,
        invoiceItemCode: code, invoiceItem: nameOf(code),
        paymentMethod: c.paymentMethod === "invoice" ? "請求書払い" : "口座振替",
        source: c.paymentMethod === "invoice" ? "manual" : "csv",
        netAmount: net, taxAmount: 0, grossAmount: net,
        transferDate: c.paymentMethod === "invoice" ? "" : transfer,
      });
    });

    // 消費税（10%・独立行）
    const tax = Math.round(taxable * 0.10);
    if (tax > 0) {
      billing.push({
        invoiceId: `b_${month}_${c.code}_080`, billingMonth: month, customerCode: c.code, customer: c.name,
        invoiceItemCode: "080", invoiceItem: "消費税",
        paymentMethod: c.paymentMethod === "invoice" ? "請求書払い" : "口座振替",
        source: c.paymentMethod === "invoice" ? "manual" : "csv",
        netAmount: tax, taxAmount: tax, grossAmount: tax,
        transferDate: c.paymentMethod === "invoice" ? "" : transfer,
      });
    }
  });

  // 内部工数で稼働を補填（目標総工数 ~150h + スタッフ/月の変動・繁忙月加算、上限175h）
  STAFF.forEach((s, si) => {
    const code = s[0];
    const mm = +month.slice(5, 7);
    const busy = (mm === 12 ? 18 : mm === 7 || mm === 6 ? 10 : 0); // 繁忙月の底上げ
    const base = 150 + ((si % 4) - 1) * 6 + busy;           // 138〜168＋繁忙
    const productive = prod[`${code}|${month}`] || 0;
    let need = Math.min(175, base) - productive;
    const internalDays = wd.filter((_, k) => k % 3 === 0);  // 平日の1/3に内部工数を散らす
    if (need > 0 && internalDays.length) {
      const per = qh(need / internalDays.length);
      internalDays.forEach((d, k) => {
        if ((prod[`${code}|${month}`] || 0) + per * (k + 1) > 175 + 5) return;
        worklogs.push({
          id: wid(), date: d, staffCode: code, customerCode: "", taskCode: "", phaseCode: "",
          taskType: "社内/その他", hours: per, memo: `${mm}月 社内業務・打合せ・自己研鑽`,
        });
      });
    }
  });

  // 目標（帰属売上から達成率90〜110%域へ較正）
  STAFF.forEach((s, si) => {
    const code = s[0];
    const a = attr[`${code}|${month}`] || 0;
    const mi = MONTHS.indexOf(month);
    const desired = 0.90 + (((si * 3 + mi * 5) % 21) / 100); // 0.90〜1.10（決定論）
    const target = Math.max(50000, Math.round((a / desired) / 10000) * 10000);
    targets.push({ targetMonth: month, staffCode: code, targetAmount: target });
  });
});

function wl(date, staffCode, custCode, code, phase, hours, memo) {
  return { id: wid(), date, staffCode, customerCode: custCode, taskCode: code, phaseCode: phase, taskType: nameOf(code), hours, memo };
}

// ====================== SQL 出力 ======================
function batchInsert(table, cols, rows, toVals) {
  if (!rows.length) return "";
  const out = [];
  const SIZE = 200;
  for (let i = 0; i < rows.length; i += SIZE) {
    const chunk = rows.slice(i, i + SIZE).map((r) => `(${toVals(r)})`).join(",\n  ");
    out.push(`INSERT INTO ${table} (${cols.join(", ")}) VALUES\n  ${chunk};`);
  }
  return out.join("\n");
}

const sql = [];
sql.push("-- pro デモデータ（自動生成・gen-demo-pro.mjs）");
sql.push("SET NAMES utf8mb4;");
sql.push("-- クリア（マスタ=staff/users/task は保持）");
sql.push("DELETE FROM jo_worklogs;");
sql.push("DELETE FROM jo_billings;");
sql.push("DELETE FROM jo_customer_staff;");
sql.push("DELETE FROM jo_staff_targets;");
sql.push("DELETE FROM jo_customers;");

sql.push(batchInsert("jo_customers",
  ["code", "name", "paymentMethod", "honorific", "sortOrder", "isActive", "updatedAt"],
  CUSTOMERS,
  (c) => `'${esc(c.code)}','${esc(c.name)}','${c.paymentMethod}','御中',${c.idx + 1},1,NOW()`));

sql.push(batchInsert("jo_customer_staff",
  ["customerCode", "role", "staffCode", "effectiveFrom", "sortOrder", "updatedAt"],
  custStaff,
  (r) => `'${esc(r.customerCode)}','${r.role}','${esc(r.staffCode)}','${esc(r.effectiveFrom)}',${r.sortOrder},NOW()`));

sql.push(batchInsert("jo_staff_targets",
  ["targetMonth", "staffCode", "targetAmount", "updatedAt"],
  targets,
  (r) => `'${r.targetMonth}','${esc(r.staffCode)}',${r.targetAmount},NOW()`));

sql.push(batchInsert("jo_billings",
  ["invoiceId", "billingMonth", "customerCode", "customer", "invoiceItemCode", "invoiceItem", "paymentMethod", "source", "netAmount", "taxAmount", "grossAmount", "transferDate", "updatedAt"],
  billing,
  (r) => `'${esc(r.invoiceId)}','${r.billingMonth}','${esc(r.customerCode)}','${esc(r.customer)}','${esc(r.invoiceItemCode)}','${esc(r.invoiceItem)}','${esc(r.paymentMethod)}','${r.source}',${r.netAmount},${r.taxAmount},${r.grossAmount},${r.transferDate ? `'${r.transferDate}'` : "NULL"},NOW()`));

sql.push(batchInsert("jo_worklogs",
  ["id", "date", "staffCode", "customerCode", "taskCode", "phaseCode", "taskType", "hours", "memo", "updatedAt"],
  worklogs,
  (r) => `'${esc(r.id)}','${r.date}','${esc(r.staffCode)}',${r.customerCode ? `'${esc(r.customerCode)}'` : "NULL"},${r.taskCode ? `'${esc(r.taskCode)}'` : "NULL"},${r.phaseCode ? `'${esc(r.phaseCode)}'` : "NULL"},'${esc(r.taskType)}',${r.hours},'${esc(r.memo)}',NOW()`));

const outPath = process.argv[2] || "demo_pro.sql";
writeFileSync(outPath, sql.join("\n") + "\n", "utf8");

// 統計（標準出力）
const totalNet = billing.filter((b) => b.invoiceItemCode !== "080").reduce((s, b) => s + b.netAmount, 0);
const byMonth = {};
billing.forEach((b) => { if (b.invoiceItemCode !== "080") byMonth[b.billingMonth] = (byMonth[b.billingMonth] || 0) + b.netAmount; });
const hoursByStaffMonth = {};
worklogs.forEach((w) => { const k = `${w.staffCode}|${w.date.slice(0,7)}`; hoursByStaffMonth[k] = (hoursByStaffMonth[k] || 0) + w.hours; });
const sampleStaff = STAFF[3][0];
console.log(JSON.stringify({
  rows: { customers: CUSTOMERS.length, customerStaff: custStaff.length, targets: targets.length, billing: billing.length, worklogs: worklogs.length },
  totalNetAllMonths: totalNet,
  monthlyNet: byMonth,
  sampleMonthlyHours_JS001: MONTHS.map((m) => ({ m, h: Math.round((hoursByStaffMonth[`${sampleStaff}|${m}`] || 0) * 10) / 10 })),
  outPath,
}, null, 2));

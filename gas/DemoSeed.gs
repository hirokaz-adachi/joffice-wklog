/**
 * 案2 デモデータ再構築（合成・多月）。
 * Apps Script エディタから rebuildDemo() を1回実行する。
 *
 * 仕様（2026-06-25 更新：顧客を受領実マスタへ）:
 *  - 期間 2026-04〜06 / 工数は平日へ分散 / 月間税抜売上 約360〜440万。
 *  - スタッフ8名・顧客40社（実顧客＝かつ・かいしゅう関与先コード基準）。全工数にメモを付与（実運用前提）。
 *  - 複数明細セル（同一 日×顧客×業務×工程に2件）を月3〜4個仕込む。
 *  - 業務区分は確定カタログ（Code.gs TASK_CATALOG）。配賦対象外=027/028/060、税=080。
 *
 * 生成内容は scripts/demo-dataset.mjs（Node 参照実装）と一致し、
 * scripts/verify-demo.mjs が配賦エンジンで売上レンジ・整合・複数明細・メモを検証済み。
 * 役務売上=Σ帰属売上 の整合は配賦エンジン側が保証する。
 */
const DEMO = {
  months: ["2026-04", "2026-05", "2026-06"],
  staff: [
    ["S001", "山田太郎"], ["S002", "佐藤花子"], ["S003", "鈴木一郎"], ["S004", "高橋美咲"],
    ["S005", "田中健太"], ["S006", "渡辺愛"], ["S007", "中村大輔"], ["S008", "小林優香"]
  ],
  // 顧客40社（受領「設計時確定顧客マスタ」＝かつ・かいしゅう関与先コード基準。請求CSV 2026-03 に出現する40社。
  // 名称はマスタ正本（36社）＋マスタ欠番4社=0003/0009/0021/0023 は請求CSV由来。コードは請求CSVと恒等一致）
  customers: [
    ["0001", "やぎゅう医院　堀江　栄子"], ["0002", "医療法人さくら会"], ["0003", "加藤　秀之"], ["0004", "咲皮ふ科クリニック　清村　咲子"],
    ["0005", "ちあふるクリニック　杉山　尚人"], ["0006", "しののめメディカルクリニック　根本　慧"], ["0007", "すぎなみ脳神経外科　遠藤　聡"], ["0009", "やりみず歯科　池内　博"],
    ["0010", "ＬＩＢＥＲ　ＣＬＩＮＩＣ　矢橋　洋一郎"], ["0011", "一般社団法人エルシステマコネクト"], ["0012", "株式会社ＦＲＥＥＤＯＭＤＵＴＹ"], ["0013", "Verno Medical Science"],
    ["0015", "武田内科小児科クリニック"], ["0016", "株式会社ＣＯＲＥ　ＣＯＮＮＥＣＴ"], ["0018", "カ）シアタ－．ブレ－ン"], ["0019", "ＧＬＯＢＥ　ＡＩＲ　ＣＡＲＧＯ合同会社"],
    ["0020", "町田歯科医院　町田寛"], ["0021", "白金いびき・内科クリニック　内田　晃司"], ["0022", "れいめいクリニック浅草橋　頴川　博芸"], ["0023", "岩切　琢磨"],
    ["0024", "医療法人社団ゆうま会　理事長　赤尾正樹"], ["0025", "ＣＯＤＥ　ＢＥＡＵＴＹ　ＣＬＩＮＩＣ"], ["0026", "医）真惺会  北総メンタルクリニック　木村真人"], ["0027", "ZEON Clinic 銀座　成井　尭史"],
    ["0028", "医療法人社団大瑛会　せきね耳鼻咽喉科クリニック　関根　大喜"], ["0029", "医療法人慈裕会 おおば皮膚科クリニック"], ["0030", "医療法人社団昌晃会 千代田歯科"], ["0031", "ＳＵＮＡＯ　ＲＥＡＬＴＹ株式会社"],
    ["0032", "吉住皮膚科クリニック"], ["0033", "医療法人社団おがわクリニック"], ["0034", "株式会社ONE"], ["0035", "株式会社エンタス"],
    ["0036", "東大宮泌尿器科クリニック　倉内　崇至"], ["0037", "くどうまさと在宅診療所　工藤　雅人"], ["0038", "一般社団法人白金桜会　白金いびき・内科クリニック　内田　晃司"], ["0039", "株式会社パラリズム"],
    ["0040", "合同会社宇宙酒場"], ["0041", "オラクル美容皮膚科　名古屋院"], ["0042", "やりみず歯科　池内　博"], ["0043", "豊田駅前うだクリニック"]
  ],
  targetPerStaff: 480000
};

// 複数明細セルを仕込む顧客 index（各月3〜4件）。給与計算(026)の Prepare 工数を2件に分割する。
const DEMO_MULTI_CELLS = {
  "2026-04": [2, 7, 13],
  "2026-05": [1, 9, 15, 20],
  "2026-06": [4, 11, 18]
};
// 時系列デモ: 顧客index0（0001）の Prepare 担当を 2026-05 から S002 へ交代。
const DEMO_PRE_CHANGE = { custIndex: 0, month: "2026-05", staff: "S002" };

function rebuildDemo() {
  ensureSheets_();
  applyCodeFormats_();
  seedTaskCatalog_();          // Code.gs TASK_CATALOG（確定15コード）/PHASES から再構築
  seedSettings_();
  seedStaffAndCustomers_();
  seedCustomerStaff_();
  generateBillingAndWorklogs_();
  deleteSheetIfExists_("item_master"); // 案2: 品目（請求項目）マスタを撤去（task_master に一本化）
  invalidateDashboardCache_();
  return "rebuildDemo done";
}

function seedSettings_() {
  saveSetting_("billingOffset", "0");
}

function seedStaffAndCustomers_() {
  const staffSheet = ensureSheet_(CONFIG.sheets.staff, CONFIG.headers.staff);
  clearDataRows_(staffSheet);
  DEMO.staff.forEach((s) => staffSheet.appendRow([s[0], s[1]]));

  const custSheet = ensureSheet_(CONFIG.sheets.customers, CONFIG.headers.customers);
  clearDataRows_(custSheet);
  DEMO.customers.forEach((c) => custSheet.appendRow([c[0], c[1]]));
}

// 1顧客=Prepare担当1名＋Review担当1名（8名を巡回・REVは+3オフセット）。
function preStaffOf_(i) { return DEMO.staff[i % DEMO.staff.length][0]; }
function revStaffOf_(i) { return DEMO.staff[(i + 3) % DEMO.staff.length][0]; }
function demoPreStaffOf_(i, month) {
  if (i === DEMO_PRE_CHANGE.custIndex && month >= DEMO_PRE_CHANGE.month) return DEMO_PRE_CHANGE.staff;
  return preStaffOf_(i);
}

// 顧客担当（時系列）。baseline は effectiveFrom 空、担当交代は有効開始月つきの追加行。
function seedCustomerStaff_() {
  const sheet = ensureSheet_(CONFIG.sheets.customerStaff, CONFIG.headers.customerStaff);
  clearDataRows_(sheet);
  const eCol = CONFIG.headers.customerStaff.indexOf("effectiveFrom") + 1;
  sheet.getRange(1, eCol, sheet.getMaxRows(), 1).setNumberFormat("@");
  const rows = [];
  DEMO.customers.forEach((c, i) => {
    rows.push([c[0], preStaffOf_(i), "PRE", 1, ""]);
    rows.push([c[0], revStaffOf_(i), "REV", 2, ""]);
  });
  rows.push([DEMO.customers[DEMO_PRE_CHANGE.custIndex][0], DEMO_PRE_CHANGE.staff, "PRE", 1, DEMO_PRE_CHANGE.month]);
  sheet.getRange(2, 1, rows.length, CONFIG.headers.customerStaff.length).setValues(rows);
}

// 給与計算の基準額（顧客ごとに分散・3万〜8万）。
function payrollOf_(i) {
  const v = 30000 + ((i * 7) % 13) * 4000 + (i % 3) * 2000;
  return Math.round(v / 1000) * 1000;
}
// 毎月の追加役務（顧問契約系）。[[code, amount], ...]
function recurringExtras_(i) {
  const out = [];
  if (i % 3 === 0) out.push(["001", 22000]);   // 労務相談（顧問）
  if (i % 5 === 0) out.push(["002", 55000]);   // 事務長代行費用（大口）
  if (i % 4 === 1) out.push(["003", 25000]);   // 有給休暇管理費用
  if (i % 6 === 2) out.push(["036", 40000]);   // スポット手続
  return out;
}
// 季節性の役務（各月200〜250万に収まる範囲で6月にやや厚み）。
function seasonalItems_(i, month) {
  const out = [];
  if (month === "2026-06") {
    out.push(["063", 12000]);                  // 労働保険年度更新（全社・6月）
    if (i % 5 === 0) out.push(["056", 38000]); // 夏賞与計算（一部）
  }
  if (month === "2026-05" && i % 6 === 0) out.push(["036", 25000]); // 5月スポット手続（一部）
  return out;
}
// 配賦対象外（立替・手数料）。請求のみ・工数なし。
function excludedItems_(i) {
  const out = [];
  if (i % 2 === 0) out.push(["060", 2000]);    // 諸費用（立替）
  if (i % 4 === 0) out.push(["027", 5000]);    // FBデータ作成費用（手数料）
  if (i % 6 === 0) out.push(["028", 3000]);    // マイナンバー管理料金
  return out;
}

function ratioOf_(code, phaseCode) {
  for (let i = 0; i < TASK_CATALOG.length; i += 1) {
    if (TASK_CATALOG[i][0] === code) return phaseCode === "PRE" ? TASK_CATALOG[i][3] : TASK_CATALOG[i][4];
  }
  return 0;
}
function nameOf_(code) {
  for (let i = 0; i < TASK_CATALOG.length; i += 1) {
    if (TASK_CATALOG[i][0] === code) return TASK_CATALOG[i][1];
  }
  return code;
}
function transferDateOf_(month) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return ny + "-" + String(nm).padStart(2, "0") + "-22";
}
// 月の平日（YYYY-MM-DD）一覧。
function weekdaysOf_(month) {
  const y = Number(month.slice(0, 4));
  const mo = Number(month.slice(5, 7));
  const last = new Date(y, mo, 0).getDate();
  const days = [];
  for (let d = 1; d <= last; d += 1) {
    const dow = new Date(y, mo - 1, d).getDay();
    if (dow !== 0 && dow !== 6) days.push(month + "-" + String(d).padStart(2, "0"));
  }
  return days;
}
function monthLabel_(m) { return Number(m.slice(5, 7)) + "月"; }
function phaseLabel_(p) { return p === "PRE" ? "Prepare" : (p === "REV" ? "Review" : ""); }
function memoFor_(month, custName, code, phase, variant) {
  const base = monthLabel_(month) + "分 " + nameOf_(code);
  const ph = phase ? "（" + phaseLabel_(phase) + "）" : "";
  if (variant === 2) return base + ph + " 追加対応分";
  return base + ph + " " + custName;
}
function qh_(x) { return Math.max(0.25, Math.round(x * 4) / 4); }

function generateBillingAndWorklogs_() {
  const billingSheet = ensureSheet_(CONFIG.sheets.billing, CONFIG.headers.billing);
  const worklogSheet = ensureSheet_(CONFIG.sheets.worklogs, CONFIG.headers.worklogs);
  const targetSheet = ensureSheet_(CONFIG.sheets.targets, CONFIG.headers.targets);
  clearDataRows_(billingSheet);
  clearDataRows_(worklogSheet);
  clearDataRows_(targetSheet);

  const billingRows = [];
  const worklogRows = [];

  DEMO.months.forEach((month) => {
    const transfer = transferDateOf_(month);
    const wdays = weekdaysOf_(month);
    const multi = DEMO_MULTI_CELLS[month] || [];

    DEMO.customers.forEach((c, ci) => {
      const custCode = c[0];
      const custName = c[1];
      const pre = demoPreStaffOf_(ci, month);
      const rev = revStaffOf_(ci);
      const services = [["026", payrollOf_(ci)]].concat(recurringExtras_(ci)).concat(seasonalItems_(ci, month));
      let taxable = 0;

      services.forEach((it, idx) => {
        const code = it[0];
        const net = it[1];
        taxable += net;
        billingRows.push(billingObj_(month, custCode, custName, code, net, transfer));

        const date = wdays[(ci * 3 + idx * 5) % wdays.length];
        if (ratioOf_(code, "PRE") > 0) {
          const hTotal = qh_(net * (ratioOf_(code, "PRE") / 100) / 12000);
          const splitMulti = multi.indexOf(ci) >= 0 && code === "026";
          if (splitMulti && hTotal >= 0.5) {
            const h1 = qh_(hTotal * 0.6);
            const rem = (hTotal - h1) < 0.25 ? 0.25 : (hTotal - h1);
            const h2 = qh_(rem);
            worklogRows.push(worklogObj_(date, pre, custCode, custName, code, "PRE", h1, memoFor_(month, custName, code, "PRE", 1), "a"));
            worklogRows.push(worklogObj_(date, pre, custCode, custName, code, "PRE", h2, memoFor_(month, custName, code, "PRE", 2), "b"));
          } else {
            worklogRows.push(worklogObj_(date, pre, custCode, custName, code, "PRE", hTotal, memoFor_(month, custName, code, "PRE", 1), ""));
          }
        }
        if (ratioOf_(code, "REV") > 0) {
          const date2 = wdays[(ci * 3 + idx * 5 + 2) % wdays.length];
          const hRev = qh_(net * (ratioOf_(code, "REV") / 100) / 14000);
          worklogRows.push(worklogObj_(date2, rev, custCode, custName, code, "REV", hRev, memoFor_(month, custName, code, "REV", 1), ""));
        }
      });

      excludedItems_(ci).forEach((it) => {
        const code = it[0];
        const net = it[1];
        taxable += net;
        billingRows.push(billingObj_(month, custCode, custName, code, net, transfer));
      });

      const tax = Math.round(taxable * 0.10);
      if (tax > 0) billingRows.push(billingObj_(month, custCode, custName, "080", tax, transfer));
    });

    // 社内/非生産（各スタッフ・月2回・平日）
    DEMO.staff.forEach((s, si) => {
      [0, 1].forEach((k) => {
        const date = wdays[(si * 4 + k * 9) % wdays.length];
        worklogRows.push(internalWorklogObj_(date, s[0], qh_(2.5 + (si % 3) * 0.5), k, monthLabel_(month)));
      });
    });

    DEMO.staff.forEach((s) => targetSheet.appendRow([month, s[0], s[1], DEMO.targetPerStaff]));
  });

  appendRowsByHeaders_(billingSheet, CONFIG.headers.billing, billingRows);
  appendRowsByHeaders_(worklogSheet, CONFIG.headers.worklogs, worklogRows);
}

function billingObj_(month, custCode, custName, code, net, transferDate) {
  return {
    invoiceId: "b_" + month + "_" + custCode + "_" + code,
    billingMonth: month,
    customerCode: custCode,
    customer: custName,
    invoiceItem: nameOf_(code),
    invoiceItemCode: code,
    paymentMethod: "口座振替",
    netAmount: net,
    taxAmount: 0,
    grossAmount: net,
    transferDate: transferDate,
    issuedDate: "",
    paymentDueDate: "",
    paymentStatus: "",
    memo: ""
  };
}

function worklogObj_(date, staffCode, custCode, custName, code, phaseCode, hours, memo, suffix) {
  return {
    id: "w_" + date + "_" + custCode + "_" + code + "_" + phaseCode + (suffix ? "_" + suffix : ""),
    date: date,
    staffCode: staffCode,
    staff: staffNameOf_(staffCode),
    customerCode: custCode,
    customer: custName,
    taskType: nameOf_(code),
    taskCode: code,
    phaseCode: phaseCode,
    hours: hours,
    memo: memo,
    updatedAt: date + "T09:00:00Z"
  };
}

function internalWorklogObj_(date, staffCode, hours, slot, monthLbl) {
  return {
    id: "w_" + date + "_INT_" + staffCode + "_" + slot,
    date: date,
    staffCode: staffCode,
    staff: staffNameOf_(staffCode),
    customerCode: "",
    customer: "",
    taskType: "社内/その他",
    taskCode: "",
    phaseCode: "",
    hours: hours == null ? 3 : hours,
    memo: monthLbl + " 社内業務・打合せ",
    updatedAt: date + "T09:00:00Z"
  };
}

function staffNameOf_(code) {
  for (let i = 0; i < DEMO.staff.length; i += 1) {
    if (DEMO.staff[i][0] === code) return DEMO.staff[i][1];
  }
  return code;
}

// オブジェクト配列をヘッダー順に並べて一括書き込み。
function appendRowsByHeaders_(sheet, headers, objs) {
  if (!objs.length) return;
  const matrix = objs.map((obj) => headers.map((h) => obj[h] == null ? "" : obj[h]));
  sheet.getRange(sheet.getLastRow() + 1, 1, matrix.length, headers.length).setValues(matrix);
}

// 指定シートが存在すれば削除（item_master 撤去用・冪等）。
function deleteSheetIfExists_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name);
  if (sh) ss.deleteSheet(sh);
}

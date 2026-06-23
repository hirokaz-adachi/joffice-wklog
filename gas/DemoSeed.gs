/**
 * 案2 デモデータ再構築（合成・多月）。
 * Apps Script エディタから rebuildDemo() を1回実行する。
 * - マスタ（業務区分カタログ・工程）を seed
 * - staff / customers / customer_staff / settings を再生成
 * - worklogs / billing / targets を整合的に生成（2026-03〜05）
 *
 * 配賦の各ケースを意図的に含む:
 *   通常按分 / Review枠フォールバック(C012) / 全額フォールバック(C011×2026-04) /
 *   諸費用(excluded) / 消費税(tax・10%独立行) / 社内非生産工数。
 *
 * 役務売上=Σ帰属売上 の整合は配賦エンジン側が保証する（本データは網羅性のための合成）。
 */
const DEMO = {
  months: ["2026-03", "2026-04", "2026-05"],
  staff: [
    ["S001", "山田太郎"], ["S002", "佐藤花子"], ["S003", "鈴木一郎"],
    ["S004", "高橋美咲"], ["S005", "田中健太"], ["S006", "渡辺愛"]
  ],
  customers: [
    ["C001", "アルファ商事"], ["C002", "ベータ製作所"], ["C003", "ガンマ物流"],
    ["C004", "デルタ建設"], ["C005", "イプシロン食品"], ["C006", "ゼータ印刷"],
    ["C007", "イータ医療"], ["C008", "シータ商会"], ["C009", "イオタ電機"],
    ["C010", "カッパ運輸"], ["C011", "ラムダ興業"], ["C012", "ミュー工業"]
  ],
  monthlyTargetPerStaff: 160000
};

function rebuildDemo() {
  ensureSheets_();
  applyCodeFormats_();
  seedTaskCatalog_();
  seedSettings_();
  seedStaffAndCustomers_();
  seedCustomerStaff_();
  generateBillingAndWorklogs_();
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

// 1顧客=Prepare担当1名＋Review担当1名（スタッフを巡回割当）。
function preStaffOf_(i) { return DEMO.staff[i % DEMO.staff.length][0]; }
function revStaffOf_(i) { return DEMO.staff[(i + 2) % DEMO.staff.length][0]; }

// 時系列デモ: C001(i=0) の Prepare 担当を 2026-05 から交代させる（マスタと工数を整合させる）。
function preChangeMonthOf_(i) { return i === 0 ? "2026-05" : ""; }
function preChangeStaffOf_(i) { return i === 0 ? DEMO.staff[1 % DEMO.staff.length][0] : ""; } // S002
function demoPreStaffOf_(i, month) {
  const cm = preChangeMonthOf_(i);
  return (cm && month >= cm) ? preChangeStaffOf_(i) : preStaffOf_(i);
}
function demoRevStaffOf_(i, month) { return revStaffOf_(i); }

// 顧客担当（時系列）。baseline は effectiveFrom 空、担当交代は有効開始月つきの追加行で表現。
function seedCustomerStaff_() {
  const sheet = ensureSheet_(CONFIG.sheets.customerStaff, CONFIG.headers.customerStaff);
  clearDataRows_(sheet);
  const eCol = CONFIG.headers.customerStaff.indexOf("effectiveFrom") + 1;
  sheet.getRange(1, eCol, sheet.getMaxRows(), 1).setNumberFormat("@"); // 有効開始月をテキスト保持
  const rows = [];
  DEMO.customers.forEach((c, i) => {
    rows.push([c[0], preStaffOf_(i), "PRE", 1, ""]); // baseline Prepare
    rows.push([c[0], revStaffOf_(i), "REV", 2, ""]); // baseline Review
    if (preChangeMonthOf_(i)) {
      rows.push([c[0], preChangeStaffOf_(i), "PRE", 1, preChangeMonthOf_(i)]); // 担当交代（その月から有効）
    }
  });
  sheet.getRange(2, 1, rows.length, CONFIG.headers.customerStaff.length).setValues(rows);
}

// 顧客ごとの当月サービス品目を返す（[code, netAmount] の配列）。
function serviceItemsFor_(custIndex, month) {
  const base = 20000 + custIndex * 5000; // 給与計算の基準額（2万〜7.5万）
  const items = [["026", base]];          // 給与計算（全顧客・毎月）
  if (custIndex % 3 === 1) items.push(["001", 30000]); // 労務相談
  if (custIndex % 3 === 2) items.push(["037", 45000]); // スポット手続(70/30)
  if (custIndex === 0) items.push(["100", 80000]);      // LAI(25/75)
  if ((custIndex === 3 || custIndex === 9) && month === "2026-05") items.push(["056", 60000]); // 賞与計算(初夏)
  return items;
}

function hasMiscFor_(custIndex) { return custIndex % 2 === 0; } // 諸費用(060)を持つ顧客

function ratioOf_(code, phaseCode) {
  // TASK_CATALOG から prepare/review% を引く
  for (let i = 0; i < TASK_CATALOG.length; i += 1) {
    if (TASK_CATALOG[i][0] === code) {
      return phaseCode === "PRE" ? TASK_CATALOG[i][3] : TASK_CATALOG[i][4];
    }
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
  // 請求月の翌月22日（振替日）
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return ny + "-" + String(nm).padStart(2, "0") + "-22";
}

function generateBillingAndWorklogs_() {
  const billingSheet = ensureSheet_(CONFIG.sheets.billing, CONFIG.headers.billing);
  const worklogSheet = ensureSheet_(CONFIG.sheets.worklogs, CONFIG.headers.worklogs);
  const targetSheet = ensureSheet_(CONFIG.sheets.targets, CONFIG.headers.targets);
  clearDataRows_(billingSheet);
  clearDataRows_(worklogSheet);
  clearDataRows_(targetSheet);

  const billingRows = [];
  const worklogRows = [];
  const QHOFF = [0, 0.25, 0.5, 0.75]; // 端数（0.25時間刻み）を持たせるための決定的オフセット
  const qh = function (x) { return Math.max(0.25, Math.round(x * 4) / 4); };

  DEMO.months.forEach((month, mi) => {
    const date = month + "-15";
    const transferDate = transferDateOf_(month);

    DEMO.customers.forEach((c, ci) => {
      const custCode = c[0];
      const custName = c[1];
      const preStaff = demoPreStaffOf_(ci, month); // 月次変動を反映（工数を担当と整合）
      const revStaff = demoRevStaffOf_(ci, month);
      // フォールバック演出: C011 は 2026-04 に工数ゼロ（全額フォールバック）
      const skipAllWork = (custCode === "C011" && month === "2026-04");
      // フォールバック演出: C012 は Review 工数を常に計上しない（Review枠フォールバック）
      const skipReviewWork = (custCode === "C012");

      let taxableSum = 0;

      // --- サービス品目 ---
      serviceItemsFor_(ci, month).forEach((it) => {
        const code = it[0];
        const net = it[1];
        taxableSum += net;
        billingRows.push(billingObj_(month, custCode, custName, code, net, transferDate));
        if (skipAllWork) return; // 工数なし→全額フォールバック
        // Prepare 工数（preRatio>0 のとき）
        if (ratioOf_(code, "PRE") > 0) {
          const h = qh(net / 15000 + QHOFF[(ci + mi) % 4]);
          worklogRows.push(worklogObj_(date, preStaff, custCode, custName, code, "PRE", h));
        }
        // Review 工数（revRatio>0 かつ skipReviewWork でない）
        if (ratioOf_(code, "REV") > 0 && !skipReviewWork) {
          const h = qh(net / 40000 + QHOFF[(ci + mi + 2) % 4]);
          worklogRows.push(worklogObj_(date, revStaff, custCode, custName, code, "REV", h));
        }
      });

      // --- 諸費用(060・excluded) ---
      if (hasMiscFor_(ci)) {
        const misc = 1500;
        taxableSum += misc;
        billingRows.push(billingObj_(month, custCode, custName, "060", misc, transferDate));
        // 諸費用は工数登録なし
      }

      // --- 消費税(080・tax)＝課税対象合計の10%（独立行） ---
      const tax = Math.round(taxableSum * 0.10);
      if (tax > 0) {
        billingRows.push(billingObj_(month, custCode, custName, "080", tax, transferDate));
      }
    });

    // --- 社内/非生産工数（各スタッフ・各月） ---
    DEMO.staff.forEach((s, si) => {
      worklogRows.push(internalWorklogObj_(date, s[0], qh(3.5 + QHOFF[(si + mi) % 4])));
    });

    // --- 売上目標（各スタッフ・各月） ---
    DEMO.staff.forEach((s) => {
      targetSheet.appendRow([month, s[0], s[1], DEMO.monthlyTargetPerStaff]);
    });
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

function worklogObj_(date, staffCode, custCode, custName, code, phaseCode, hours) {
  return {
    id: "w_" + date + "_" + custCode + "_" + code + "_" + phaseCode,
    date: date,
    staffCode: staffCode,
    staff: staffNameOf_(staffCode),
    customerCode: custCode,
    customer: custName,
    taskType: nameOf_(code),
    taskCode: code,
    phaseCode: phaseCode,
    hours: hours,
    memo: "",
    updatedAt: date + "T09:00:00Z"
  };
}

function internalWorklogObj_(date, staffCode, hours) {
  return {
    id: "w_" + date + "_INT_" + staffCode,
    date: date,
    staffCode: staffCode,
    staff: staffNameOf_(staffCode),
    customerCode: "",
    customer: "",
    taskType: "社内/その他",
    taskCode: "",
    phaseCode: "",
    hours: hours == null ? 5 : hours,
    memo: "社内業務",
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

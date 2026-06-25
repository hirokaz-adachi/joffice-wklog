/**
 * デモデータ生成（DemoSeed.gs 移植の参照実装・Node 用）。
 * 要件: 2026-04〜06 / 平日分散 / 月の税抜売上 約360〜440万 / スタッフ8名・顧客40社（実顧客）/
 *       全工数にメモ / 複数明細セルを月3〜4個。
 *
 * buildDemoDataset() が allocation.js と同じ入力形を返す。
 * 検証は verify-demo.mjs から実行する。
 */

// 確定版カタログ（【DM】請求品目一覧.xlsx・2026-06-23）: [code, name, type, pre%, rev%]
export const FINAL_CATALOG = [
  ["001", "労務相談",          "service",  100, 0],
  ["002", "事務長代行費用",    "service",  100, 0],
  ["003", "有給休暇管理費用",  "service",  70, 30],
  ["026", "給与計算",          "service",  70, 30],
  ["027", "FBデータ作成費用",  "excluded", 0,  0],
  ["028", "マイナンバー管理料金", "excluded", 0, 0],
  ["036", "スポット手続",      "service",  100, 0],
  ["056", "賞与計算",          "service",  70, 30],
  ["060", "諸費用",            "excluded", 0,  0],
  ["061", "給与支払報告書",    "service",  70, 30],
  ["062", "算定基礎届",        "service",  70, 30],
  ["063", "労働保険年度更新",  "service",  70, 30],
  ["064", "住民税変更",        "service",  70, 30],
  ["065", "年末調整",          "service",  70, 30],
  ["080", "消費税",            "tax",      0,  0]
];

export const MONTHS = ["2026-04", "2026-05", "2026-06"];

export const STAFF = [
  ["S001", "山田太郎"], ["S002", "佐藤花子"], ["S003", "鈴木一郎"], ["S004", "高橋美咲"],
  ["S005", "田中健太"], ["S006", "渡辺愛"], ["S007", "中村大輔"], ["S008", "小林優香"]
];

// 顧客40社（受領「設計時確定顧客マスタ」＝かつ・かいしゅう関与先コード基準。請求CSV 2026-03 に出現する40社。
// 名称はマスタ正本（36社）＋マスタ欠番4社=0003/0009/0021/0023 は請求CSV由来。コードは請求CSVと恒等一致）
export const CUSTOMERS = [
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
];

const TARGET_PER_STAFF = 480000; // 8名×48万=384万/月（役務 約349〜428万に対し達成率≒90〜111%）

const nameOf = (c) => { const t = FINAL_CATALOG.find((x) => x[0] === c); return t ? t[1] : c; };
const ratioOf = (c, p) => { const t = FINAL_CATALOG.find((x) => x[0] === c); return t ? (p === "PRE" ? t[3] : t[4]) : 0; };
const typeOf = (c) => { const t = FINAL_CATALOG.find((x) => x[0] === c); return t ? t[2] : "service"; };
const staffName = (c) => { const s = STAFF.find((x) => x[0] === c); return s ? s[1] : c; };

// 担当（PRE/REV を8名で巡回）。顧客index0（0001）は 2026-05 から Prepare 担当交代（時系列デモ）。
const preStaff = (i) => STAFF[i % STAFF.length][0];
const revStaff = (i) => STAFF[(i + 3) % STAFF.length][0];
const PRE_CHANGE = { custIndex: 0, month: "2026-05", staff: "S002" };
function preStaffAsOf(i, month) {
  if (i === PRE_CHANGE.custIndex && month >= PRE_CHANGE.month) return PRE_CHANGE.staff;
  return preStaff(i);
}

// 給与計算の基準額（顧客ごとに分散・3万〜8万）。
function payrollOf(i) {
  const v = 30000 + ((i * 7) % 13) * 4000 + (i % 3) * 2000; // 30k〜~82k
  return Math.round(v / 1000) * 1000;
}

// 毎月の追加役務（顧問契約系）。[code, amount]
function recurringExtras(i) {
  const out = [];
  if (i % 3 === 0) out.push(["001", 22000]);          // 労務相談（顧問）
  if (i % 5 === 0) out.push(["002", 55000]);          // 事務長代行費用（大口）
  if (i % 4 === 1) out.push(["003", 25000]);          // 有給休暇管理費用
  if (i % 6 === 2) out.push(["036", 40000]);          // スポット手続
  return out;
}

// 季節性の役務（4〜6月）。各月が200〜250万に収まる範囲で6月にやや厚みを持たせる。
function seasonalItems(i, month) {
  const out = [];
  if (month === "2026-06") {
    out.push(["063", 12000]);                         // 労働保険年度更新（全社・6月）
    if (i % 5 === 0) out.push(["056", 38000]);        // 夏賞与計算（一部）
  }
  if (month === "2026-05" && i % 6 === 0) out.push(["036", 25000]); // 5月スポット手続（一部）
  return out;
}

// 配賦対象外（立替・手数料）。[code, amount]
function excludedItems(i) {
  const out = [];
  if (i % 2 === 0) out.push(["060", 2000]);           // 諸費用（立替）
  if (i % 4 === 0) out.push(["027", 5000]);           // FBデータ作成費用（手数料）
  if (i % 6 === 0) out.push(["028", 3000]);           // マイナンバー管理料金
  return out;
}

// 複数明細セルを仕込む (month, custIndex)。各月3〜4件。
const MULTI_CELLS = {
  "2026-04": [2, 7, 13],
  "2026-05": [1, 9, 15, 20],
  "2026-06": [4, 11, 18]
};

const transferOf = (m) => {
  const y = +m.slice(0, 4), mo = +m.slice(5, 7);
  const ny = mo === 12 ? y + 1 : y, nm = mo === 12 ? 1 : mo + 1;
  return ny + "-" + String(nm).padStart(2, "0") + "-22";
};

// 月の平日（YYYY-MM-DD）一覧。
function weekdaysOf(month) {
  const y = +month.slice(0, 4), mo = +month.slice(5, 7);
  const last = new Date(y, mo, 0).getDate();
  const days = [];
  for (let d = 1; d <= last; d += 1) {
    const dow = new Date(y, mo - 1, d).getDay();
    if (dow !== 0 && dow !== 6) days.push(`${month}-${String(d).padStart(2, "0")}`);
  }
  return days;
}

const monthLabel = (m) => `${+m.slice(5, 7)}月`;
const phaseLabel = (p) => (p === "PRE" ? "Prepare" : p === "REV" ? "Review" : "");
function memoFor(month, custName, code, phase, variant) {
  const base = `${monthLabel(month)}分 ${nameOf(code)}`;
  const ph = phase ? `（${phaseLabel(phase)}）` : "";
  if (variant === 2) return `${base}${ph} 追加対応分`;
  return `${base}${ph} ${custName}`;
}

const qh = (x) => Math.max(0.25, Math.round(x * 4) / 4);

export function buildDemoDataset() {
  const tasks = FINAL_CATALOG.map((t) => ({ code: t[0], name: t[1], allocationType: t[2] }));
  const taskPhases = [];
  FINAL_CATALOG.forEach((t) => {
    if (t[2] === "service") {
      taskPhases.push({ taskCode: t[0], phaseCode: "PRE", phaseName: "Prepare", ratio: t[3], sortOrder: 1 });
      taskPhases.push({ taskCode: t[0], phaseCode: "REV", phaseName: "Review", ratio: t[4], sortOrder: 2 });
    }
  });
  const customerStaff = [];
  CUSTOMERS.forEach((c, i) => {
    customerStaff.push({ customerCode: c[0], staffCode: preStaff(i), role: "PRE", sortOrder: 1, effectiveFrom: "" });
    customerStaff.push({ customerCode: c[0], staffCode: revStaff(i), role: "REV", sortOrder: 2, effectiveFrom: "" });
  });
  // 時系列デモ: 顧客index0（0001）の Prepare を 2026-05 から S002 へ
  customerStaff.push({ customerCode: CUSTOMERS[PRE_CHANGE.custIndex][0], staffCode: PRE_CHANGE.staff, role: "PRE", sortOrder: 1, effectiveFrom: PRE_CHANGE.month });

  const billing = [];
  const entries = [];
  const targets = [];

  MONTHS.forEach((month) => {
    const transfer = transferOf(month);
    const wdays = weekdaysOf(month);
    const multiSet = new Set(MULTI_CELLS[month] || []);

    CUSTOMERS.forEach((c, ci) => {
      const custCode = c[0], custName = c[1];
      const pre = preStaffAsOf(ci, month);
      const rev = revStaff(ci);
      // 役務（給与計算＋追加＋季節）
      const services = [["026", payrollOf(ci)], ...recurringExtras(ci), ...seasonalItems(ci, month)];
      let taxable = 0;

      services.forEach((it, idx) => {
        const [code, net] = it;
        taxable += net;
        billing.push(billingObj(month, custCode, custName, code, net, transfer));
        // 作業日（平日・顧客と品目でずらす）
        const date = wdays[(ci * 3 + idx * 5) % wdays.length];
        // Prepare 工数
        if (ratioOf(code, "PRE") > 0) {
          const hTotal = qh(net * (ratioOf(code, "PRE") / 100) / 12000);
          const splitMulti = multiSet.has(ci) && code === "026"; // 給与計算で複数明細を演出
          if (splitMulti && hTotal >= 0.5) {
            const h1 = qh(hTotal * 0.6), h2 = qh(hTotal - h1 < 0.25 ? 0.25 : hTotal - h1);
            entries.push(wl(date, pre, custCode, custName, code, "PRE", h1, memoFor(month, custName, code, "PRE", 1), "a"));
            entries.push(wl(date, pre, custCode, custName, code, "PRE", h2, memoFor(month, custName, code, "PRE", 2), "b"));
          } else {
            entries.push(wl(date, pre, custCode, custName, code, "PRE", hTotal, memoFor(month, custName, code, "PRE", 1), ""));
          }
        }
        // Review 工数
        if (ratioOf(code, "REV") > 0) {
          const date2 = wdays[(ci * 3 + idx * 5 + 2) % wdays.length];
          const hRev = qh(net * (ratioOf(code, "REV") / 100) / 14000);
          entries.push(wl(date2, rev, custCode, custName, code, "REV", hRev, memoFor(month, custName, code, "REV", 1), ""));
        }
      });

      // 配賦対象外（立替・手数料）＝請求のみ、工数なし
      excludedItems(ci).forEach((it) => {
        const [code, net] = it;
        taxable += net;
        billing.push(billingObj(month, custCode, custName, code, net, transfer));
      });

      // 消費税（課税対象合計の10%・独立行）
      const tax = Math.round(taxable * 0.10);
      if (tax > 0) billing.push(billingObj(month, custCode, custName, "080", tax, transfer));
    });

    // 社内/非生産（各スタッフ・月2回・平日）
    STAFF.forEach((s, si) => {
      [0, 1].forEach((k) => {
        const date = wdays[(si * 4 + k * 9) % wdays.length];
        entries.push({
          id: `w_${date}_INT_${s[0]}_${k}`, date, staffCode: s[0], staff: s[1],
          customerCode: "", customer: "", taskType: "社内/その他", taskCode: "", phaseCode: "",
          hours: qh(2.5 + (si % 3) * 0.5), memo: `${monthLabel(month)} 社内業務・打合せ`, updatedAt: date + "T09:00:00Z"
        });
      });
    });

    STAFF.forEach((s) => targets.push({ targetMonth: month, staffCode: s[0], staff: s[1], targetAmount: TARGET_PER_STAFF }));
  });

  return {
    staff: STAFF.map((s) => ({ code: s[0], name: s[1] })),
    customers: CUSTOMERS.map((c) => ({ code: c[0], name: c[1] })),
    tasks, taskPhases, customerStaff,
    settings: { billingOffset: "0" },
    entries, billing, targets
  };
}

function billingObj(month, custCode, custName, code, net, transfer) {
  return {
    invoiceId: `b_${month}_${custCode}_${code}`, billingMonth: month,
    customerCode: custCode, customer: custName,
    invoiceItem: nameOf(code), invoiceItemCode: code,
    paymentMethod: "口座振替", netAmount: net, taxAmount: 0, grossAmount: net,
    transferDate: transfer, issuedDate: "", paymentDueDate: "", paymentStatus: "", memo: ""
  };
}

function wl(date, staffCode, custCode, custName, code, phase, hours, memo, suffix) {
  return {
    id: `w_${date}_${custCode}_${code}_${phase}${suffix ? "_" + suffix : ""}`,
    date, staffCode, staff: staffName(staffCode),
    customerCode: custCode, customer: custName,
    taskType: nameOf(code), taskCode: code, phaseCode: phase,
    hours, memo, updatedAt: date + "T09:00:00Z"
  };
}

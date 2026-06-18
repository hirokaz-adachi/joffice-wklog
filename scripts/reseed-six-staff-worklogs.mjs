const API_URL = "https://script.google.com/macros/s/AKfycbyisWQGRuGpUjw9CXmpzT9ojZXLp2eCxZm277IDxyPHksncl-Ru0E5ajeOGJMjiUBCH/exec";
const API_TOKEN = "joffice-wklog-api";

const staff = [
  ["S001", "高橋 美咲"],
  ["S002", "佐藤 健太"],
  ["S003", "鈴木 彩花"],
  ["S004", "田中 大輔"],
  ["S005", "伊藤 麻衣"],
  ["S006", "渡辺 拓也"]
].map(([code, name]) => ({ code, name }));

const customers = [
  ["C001", "医療法人さくらみらい会 さくら総合クリニック"],
  ["C002", "医療法人青葉会 青葉内科クリニック"],
  ["C003", "医療法人ひかり会 ひかりファミリークリニック"],
  ["C004", "医療法人健心会 健心循環器クリニック"],
  ["C005", "医療法人つばさ会 つばさ小児科"],
  ["C006", "医療法人清流会 清流消化器内科"],
  ["C007", "医療法人若葉会 若葉整形外科"],
  ["C008", "医療法人和心会 和心メンタルクリニック"],
  ["C009", "医療法人恵風会 恵風耳鼻咽喉科"],
  ["C011", "医療法人星和会 星和眼科クリニック"],
  ["C012", "医療法人あおぞら会 あおぞら皮膚科"],
  ["C013", "医療法人悠生会 悠生泌尿器科"],
  ["C014", "医療法人白樺会 白樺レディースクリニック"],
  ["C015", "医療法人翠明会 翠明脳神経外科"],
  ["C016", "医療法人瑞穂会 瑞穂リハビリテーション医院"],
  ["C017", "医療法人陽だまり会 陽だまり在宅クリニック"],
  ["C018", "医療法人みなと会 みなと呼吸器内科"],
  ["C019", "医療法人橘会 橘糖尿病クリニック"],
  ["C020", "医療法人新緑会 新緑胃腸科医院"],
  ["C021", "医療法人こもれび会 こもれび歯科医院"],
  ["C022", "医療法人なぎさ会 なぎさデンタルクリニック"],
  ["C023", "医療法人桜泉会 桜泉矯正歯科"],
  ["C024", "医療法人優和会 優和こども歯科"],
  ["C025", "医療法人明徳会 明徳総合病院"],
  ["C026", "医療法人仁愛会 仁愛記念病院"],
  ["C027", "医療法人光洋会 光洋リハビリ病院"],
  ["C028", "医療法人豊生会 豊生透析クリニック"],
  ["C029", "医療法人春風会 春風訪問診療所"],
  ["C030", "医療法人望月会 望月産婦人科"],
  ["C031", "医療法人北斗会 北斗救急クリニック"],
  ["C032", "医療法人彩雲会 彩雲アレルギー科"],
  ["C033", "医療法人康成会 康成腎クリニック"],
  ["C034", "医療法人緑樹会 緑樹神経内科"],
  ["C035", "医療法人東雲会 東雲健診センター"],
  ["C036", "社会福祉法人みどり福祉会"],
  ["C037", "株式会社ケアサポート結"],
  ["C038", "有限会社あんしん薬局"],
  ["C039", "株式会社メディカルリンク"],
  ["C040", "合同会社訪問看護ステーション虹"],
  ["C041", "株式会社スマイル介護サービス"],
  ["C042", "社会福祉法人ひなた会"],
  ["C043", "株式会社ウェルネスパートナーズ"],
  ["C044", "合同会社地域ケア研究所"],
  ["C045", "株式会社ヘルスケアデザイン"],
  ["C046", "医療法人朝凪会 朝凪ペインクリニック"]
].map(([code, name]) => ({ code, name }));

const customerCodesByStaff = {
  S001: ["C025", "C026", "C036", "C040", "C042", "C017", "C035", "C045"],
  S002: ["C027", "C028", "C037", "C039", "C041", "C043", "C031", "C033"],
  S003: ["C001", "C004", "C006", "C015", "C018", "C030", "C032"],
  S004: ["C002", "C003", "C007", "C008", "C009", "C011", "C012"],
  S005: ["C013", "C014", "C016", "C019", "C020", "C029", "C034"],
  S006: ["C005", "C021", "C022", "C023", "C024", "C038", "C044", "C046"]
};

const hoursByStaffAndMonth = {
  S001: {
    3: [2.0, 1.75, 1.25, 1.25],
    4: [2.0, 1.5, 1.25, 1.5],
    5: [2.25, 1.75, 1.25, 1.25]
  },
  S002: {
    3: [2.0, 1.75, 1.25, 2.0],
    4: [2.0, 1.5, 1.25, 2.0],
    5: [2.25, 1.75, 1.25, 2.0]
  },
  S003: {
    3: [1.75, 1.5, 1.0, 1.25],
    4: [2.0, 1.5, 1.0, 1.25],
    5: [1.75, 1.5, 1.0, 1.5]
  },
  S004: {
    3: [1.5, 1.25, 0.75, 3.0],
    4: [1.5, 1.0, 0.75, 3.25],
    5: [1.75, 1.0, 0.75, 3.0]
  },
  S005: {
    3: [1.75, 1.25, 1.0, 2.0],
    4: [1.75, 1.5, 1.0, 2.0],
    5: [1.5, 1.5, 1.0, 2.0]
  },
  S006: {
    3: [2.0, 1.75, 1.5, 1.25],
    4: [2.25, 1.75, 1.5, 1.25],
    5: [2.25, 2.0, 1.5, 1.25]
  }
};

const memoByTask = {
  顧問対応: ["月次定例対応", "問い合わせ確認・回答", "届出状況の確認", "人事労務に関する定例連絡"],
  給与計算: ["勤怠データ確認・給与計算", "給与計算結果のチェック", "控除項目確認・給与データ作成"],
  手続き: ["入退社に伴う社会保険手続き", "雇用保険手続き", "扶養異動手続き", "算定・月額変更関連の確認"],
  労務相談: ["就業ルールに関する相談対応", "職員対応に関する助言", "勤務体制変更の相談", "労務リスクの確認"],
  助成金: ["対象要件の確認", "申請資料の整理", "助成金制度の情報提供"],
  スポット: ["規程改定に伴う資料確認", "個別案件の調査・回答", "労務資料の作成"],
  "社内/その他": ["所内ミーティング・案件進捗確認", "法改正情報の確認・所内共有", "業務整理・記録・ダブルチェック", "研修・ナレッジ共有"]
};

function weekdays(year, month) {
  const result = [];
  const lastDay = new Date(year, month, 0).getDate();
  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(year, month - 1, day);
    if (date.getDay() !== 0 && date.getDay() !== 6) result.push(day);
  }
  return result;
}

function dateText(month, day) {
  return `2026/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

function assignedCustomers(staffIndex) {
  const codes = new Set(customerCodesByStaff[staff[staffIndex].code]);
  return customers.filter((customer) => codes.has(customer.code));
}

function taskFor(day, block, staffIndex) {
  if (block === 0 && day >= 12 && day <= 25) return "給与計算";
  if (block === 1 && (day + staffIndex) % 7 === 0) return "労務相談";
  if (block === 2 && (day + staffIndex) % 11 === 0) return "助成金";
  if (block === 2 && (day + staffIndex) % 9 === 0) return "スポット";
  if ((day + block + staffIndex) % 3 === 0) return "手続き";
  return "顧問対応";
}

function chooseMemo(taskType, seed) {
  const options = memoByTask[taskType];
  return options[seed % options.length];
}

function buildEntries() {
  const entries = [];

  for (const month of [3, 4, 5]) {
    const days = weekdays(2026, month);

    staff.forEach((person, staffIndex) => {
      const assigned = assignedCustomers(staffIndex);
      const leaveDay = days[(month * 3 + staffIndex * 5) % days.length];
      let customerCursor = month + staffIndex;

      days.filter((day) => day !== leaveDay).forEach((day, workdayIndex) => {
        const basePattern = hoursByStaffAndMonth[person.code][month];
        const pattern = rotatePattern(basePattern, workdayIndex + staffIndex);
        const directHours = pattern.slice(0, 3);
        const internalHours = pattern[3];

        directHours.forEach((hours, block) => {
          const customer = assigned[customerCursor % assigned.length];
          customerCursor += 1;
          const taskType = taskFor(day, block, staffIndex);
          entries.push({
            id: `demo6_2026${String(month).padStart(2, "0")}_${person.code}_${String(day).padStart(2, "0")}_C${block + 1}`,
            date: dateText(month, day),
            staffCode: person.code,
            staff: person.name,
            customerCode: customer.code,
            customer: customer.name,
            taskType,
            hours,
            memo: chooseMemo(taskType, day + block + staffIndex + month),
            updatedAt: `2026-06-18T13:${String(staffIndex).padStart(2, "0")}:00+09:00`
          });
        });

        entries.push({
          id: `demo6_2026${String(month).padStart(2, "0")}_${person.code}_${String(day).padStart(2, "0")}_I1`,
          date: dateText(month, day),
          staffCode: person.code,
          staff: person.name,
          customerCode: "",
          customer: "",
          taskType: "社内/その他",
          hours: internalHours,
          memo: chooseMemo("社内/その他", day + staffIndex + month),
          updatedAt: `2026-06-18T14:${String(staffIndex).padStart(2, "0")}:00+09:00`
        });
      });
    });
  }

  return entries.sort((a, b) =>
    a.date.localeCompare(b.date) ||
    a.staffCode.localeCompare(b.staffCode) ||
    a.id.localeCompare(b.id));
}

function rotatePattern(pattern, seed) {
  const direct = pattern.slice(0, 3);
  const shift = seed % direct.length;
  return [
    ...direct.slice(shift),
    ...direct.slice(0, shift),
    pattern[3]
  ];
}

async function request(action, payload) {
  const params = new URLSearchParams({
    action,
    callback: "reseedCallback",
    token: API_TOKEN,
    payload: JSON.stringify(payload)
  });
  const response = await fetch(`${API_URL}?${params}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  const match = text.match(/^[^(]+\((.*)\);?$/s);
  if (!match) throw new Error(`Unexpected response: ${text.slice(0, 200)}`);
  const result = JSON.parse(match[1]);
  if (!result.ok) throw new Error(result.error || "API error");
  return result;
}

function summarize(entries) {
  const result = {
    count: entries.length,
    totalHours: 0,
    directHours: 0,
    internalHours: 0,
    byMonth: {},
    byStaff: {},
    byStaffMonth: {},
    customerCodes: new Set()
  };

  entries.forEach((entry) => {
    const month = entry.date.slice(0, 7);
    const hours = Number(entry.hours);
    result.totalHours += hours;
    result.byMonth[month] = (result.byMonth[month] || 0) + hours;
    result.byStaff[entry.staffCode] = (result.byStaff[entry.staffCode] || 0) + hours;
    const staffMonth = `${month}:${entry.staffCode}`;
    if (!result.byStaffMonth[staffMonth]) {
      result.byStaffMonth[staffMonth] = { totalHours: 0, directHours: 0, internalHours: 0 };
    }
    result.byStaffMonth[staffMonth].totalHours += hours;
    if (entry.customerCode) {
      result.directHours += hours;
      result.byStaffMonth[staffMonth].directHours += hours;
      result.customerCodes.add(entry.customerCode);
    } else {
      result.internalHours += hours;
      result.byStaffMonth[staffMonth].internalHours += hours;
    }
  });

  return {
    ...result,
    customerCodes: [...result.customerCodes].sort(),
    directRatio: result.directHours / result.totalHours
  };
}

function summarizeDashboard(data) {
  const result = {};
  const months = [...new Set([
    ...(data.entries || []).map((entry) => normalizeMonth(entry.date)),
    ...(data.billing || []).map((item) => normalizeMonth(item.billingMonth)),
    ...(data.targets || []).map((item) => normalizeMonth(item.targetMonth))
  ])].filter(Boolean).sort();

  months.forEach((month) => {
    const monthEntries = (data.entries || []).filter((entry) => normalizeMonth(entry.date) === month);
    const monthBilling = (data.billing || []).filter((item) => normalizeMonth(item.billingMonth) === month);
    const monthTargets = (data.targets || []).filter((item) => normalizeMonth(item.targetMonth) === month);
    const customerRevenue = new Map();
    const customerStaffHours = new Map();

    monthBilling.forEach((item) => {
      customerRevenue.set(
        item.customerCode,
        (customerRevenue.get(item.customerCode) || 0) + Number(item.netAmount || 0)
      );
    });

    monthEntries.filter((entry) => entry.customerCode).forEach((entry) => {
      if (!customerStaffHours.has(entry.customerCode)) customerStaffHours.set(entry.customerCode, new Map());
      const staffHours = customerStaffHours.get(entry.customerCode);
      staffHours.set(entry.staffCode, (staffHours.get(entry.staffCode) || 0) + Number(entry.hours || 0));
    });

    const staffSummary = Object.fromEntries(staff.map((person) => [person.code, {
      totalHours: 0,
      directHours: 0,
      revenue: 0,
      target: 0
    }]));

    monthEntries.forEach((entry) => {
      const summary = staffSummary[entry.staffCode];
      if (!summary) return;
      summary.totalHours += Number(entry.hours || 0);
      if (entry.customerCode) summary.directHours += Number(entry.hours || 0);
    });

    monthTargets.forEach((target) => {
      if (staffSummary[target.staffCode]) {
        staffSummary[target.staffCode].target += Number(target.targetAmount || 0);
      }
    });

    customerStaffHours.forEach((staffHours, customerCode) => {
      const totalHours = [...staffHours.values()].reduce((total, hours) => total + hours, 0);
      const revenue = customerRevenue.get(customerCode) || 0;
      staffHours.forEach((hours, staffCode) => {
        if (staffSummary[staffCode] && totalHours) {
          staffSummary[staffCode].revenue += revenue * (hours / totalHours);
        }
      });
    });

    result[month] = Object.fromEntries(Object.entries(staffSummary).map(([code, summary]) => [code, {
      totalHours: round(summary.totalHours),
      directHours: round(summary.directHours),
      directRatio: round(summary.totalHours ? summary.directHours / summary.totalHours : 0, 3),
      revenue: Math.round(summary.revenue),
      target: summary.target,
      achievement: round(summary.target ? summary.revenue / summary.target : 0, 3),
      directRate: Math.round(summary.directHours ? summary.revenue / summary.directHours : 0)
    }]));
  });

  return result;
}

function normalizeMonth(value) {
  const text = String(value || "");
  if (/^\d{4}[-/]\d{2}/.test(text)) return text.slice(0, 7).replace("/", "-");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit"
  }).format(date);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

const entries = buildEntries();

if (process.argv.includes("--preview")) {
  console.log(JSON.stringify(summarize(entries), null, 2));
  process.exit(0);
}

if (process.argv.includes("--verify")) {
  const response = await request("bootstrap", {});
  const remoteEntries = (response.data.entries || [])
    .filter((entry) => String(entry.id || "").startsWith("demo6_2026"))
    .map((entry) => ({
      ...entry,
      date: /^\d{4}[/-]\d{2}[/-]\d{2}$/.test(String(entry.date || ""))
        ? String(entry.date).replaceAll("-", "/")
        : new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Tokyo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }).format(new Date(entry.date)).replaceAll("-", "/")
    }));
  console.log(JSON.stringify(summarize(remoteEntries), null, 2));
  process.exit(0);
}

if (process.argv.includes("--verify-dashboard")) {
  const response = await request("dashboard", { forceRefresh: true });
  console.log(JSON.stringify(summarizeDashboard(response.data || {}), null, 2));
  process.exit(0);
}

const batchSize = 5;
console.log(`Generated ${entries.length} entries.`);

for (let index = 0; index < entries.length; index += batchSize) {
  const batch = entries.slice(index, index + batchSize);
  await request("saveEntries", { entries: batch });
  console.log(`Uploaded ${Math.min(index + batch.length, entries.length)}/${entries.length}`);
}

console.log("Six-staff sample worklogs uploaded.");

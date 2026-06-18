const API_URL = "https://script.google.com/macros/s/AKfycbyisWQGRuGpUjw9CXmpzT9ojZXLp2eCxZm277IDxyPHksncl-Ru0E5ajeOGJMjiUBCH/exec";
const API_TOKEN = "joffice-wklog-api";

const staff = [
  ["S001", "高橋 美咲"], ["S002", "佐藤 健太"], ["S003", "鈴木 彩花"],
  ["S004", "田中 大輔"], ["S005", "伊藤 麻衣"], ["S006", "渡辺 拓也"],
  ["S007", "山本 奈緒"], ["S008", "中村 直樹"], ["S009", "小林 優子"],
  ["S010", "加藤 和也"], ["S011", "吉田 真由"], ["S012", "山田 裕介"],
  ["S013", "松本 千尋"], ["S014", "井上 智也"], ["S015", "木村 由佳"]
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

const memoByTask = {
  顧問対応: ["月次定例対応", "問い合わせ確認・回答", "届出状況の確認", "人事労務に関する定例連絡"],
  給与計算: ["勤怠データ確認・給与計算", "給与計算結果のチェック", "控除項目確認・給与データ作成"],
  手続き: ["入退社に伴う社会保険手続き", "雇用保険手続き", "扶養異動手続き", "算定・月額変更関連の確認"],
  労務相談: ["就業ルールに関する相談対応", "職員対応に関する助言", "勤務体制変更の相談", "労務リスクの確認"],
  助成金: ["対象要件の確認", "申請資料の整理", "助成金制度の情報提供"],
  スポット: ["規程改定に伴う資料確認", "個別案件の調査・回答", "労務資料の作成"],
  "社内/その他": ["所内ミーティング", "案件進捗確認", "法改正情報の確認", "業務整理・記録"]
};

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function weekdays(year, month) {
  const days = [];
  const end = new Date(year, month, 0).getDate();
  for (let day = 1; day <= end; day += 1) {
    const date = new Date(year, month - 1, day);
    if (date.getDay() !== 0 && date.getDay() !== 6) days.push(day);
  }
  return days;
}

function dateText(month, day) {
  return `2026/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

function choose(list, random) {
  return list[Math.floor(random() * list.length)];
}

function businessDayNear(days, target, offset) {
  const desired = target + offset;
  return days.reduce((best, day) =>
    Math.abs(day - desired) < Math.abs(best - desired) ? day : best, days[0]);
}

function buildEntries() {
  const entries = [];
  for (const month of [3, 4, 5]) {
    const days = weekdays(2026, month);
    staff.forEach((person, staffIndex) => {
      const random = seeded(month * 1000 + staffIndex * 97 + 2026);
      const assigned = [0, 15, 30].map((offset) => customers[(staffIndex + offset) % customers.length]);
      const patterns = [
        [4, "顧問対応", 1.25], [7, "手続き", 1.5],
        [10, "顧問対応", 1.0], [13, "労務相談", 1.25],
        [16, "給与計算", 3.0], [19, "給与計算", 2.0],
        [22, "顧問対応", 1.25], [25, "手続き", 1.75],
        [27, "労務相談", 1.0], [29, "スポット", 1.5]
      ];

      patterns.forEach(([target, taskType, baseHours], patternIndex) => {
        const customer = assigned[patternIndex % assigned.length];
        const day = businessDayNear(days, target, Math.floor(random() * 3) - 1);
        const variation = [-0.25, 0, 0.25, 0.5][Math.floor(random() * 4)];
        entries.push({
          id: `demo_2026${String(month).padStart(2, "0")}_${person.code}_${String(patternIndex + 1).padStart(2, "0")}`,
          date: dateText(month, day),
          staffCode: person.code,
          staff: person.name,
          customerCode: customer.code,
          customer: customer.name,
          taskType,
          hours: Math.max(0.5, baseHours + variation),
          memo: choose(memoByTask[taskType], random),
          updatedAt: `2026-06-18T09:${String(staffIndex).padStart(2, "0")}:00+09:00`
        });
      });

      const extraCount = 4 + Math.floor(random() * 3);
      for (let extra = 0; extra < extraCount; extra += 1) {
        const customer = assigned[Math.floor(random() * assigned.length)];
        const taskType = choose(["顧問対応", "手続き", "労務相談", "助成金", "スポット"], random);
        const day = choose(days, random);
        const hours = choose([0.5, 0.75, 1, 1.25, 1.5, 2], random);
        entries.push({
          id: `demo_2026${String(month).padStart(2, "0")}_${person.code}_E${String(extra + 1).padStart(2, "0")}`,
          date: dateText(month, day),
          staffCode: person.code,
          staff: person.name,
          customerCode: customer.code,
          customer: customer.name,
          taskType,
          hours,
          memo: choose(memoByTask[taskType], random),
          updatedAt: `2026-06-18T10:${String(staffIndex).padStart(2, "0")}:00+09:00`
        });
      }

      for (let internal = 0; internal < 2; internal += 1) {
        const day = days[Math.min(days.length - 1, 2 + internal * 9 + (staffIndex % 3))];
        entries.push({
          id: `demo_2026${String(month).padStart(2, "0")}_${person.code}_I${internal + 1}`,
          date: dateText(month, day),
          staffCode: person.code,
          staff: person.name,
          customerCode: "",
          customer: "",
          taskType: "社内/その他",
          hours: internal === 0 ? 1 : 0.75,
          memo: choose(memoByTask["社内/その他"], random),
          updatedAt: `2026-06-18T11:${String(staffIndex).padStart(2, "0")}:00+09:00`
        });
      }
    });
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.staffCode.localeCompare(b.staffCode) || a.id.localeCompare(b.id));
}

async function request(action, payload) {
  const callback = "seedCallback";
  const params = new URLSearchParams({
    action,
    callback,
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

const entries = buildEntries();
const batchSize = 8;

if (process.argv.includes("--verify")) {
  const response = await request("bootstrap", {});
  const demoEntries = (response.data.entries || []).filter((entry) => String(entry.id || "").startsWith("demo_2026"));
  const byMonth = {};
  const byStaff = {};
  let totalHours = 0;
  let invalidNoCustomer = 0;

  demoEntries.forEach((entry) => {
    const month = String(entry.date).slice(0, 7);
    byMonth[month] = (byMonth[month] || 0) + 1;
    byStaff[entry.staffCode] = (byStaff[entry.staffCode] || 0) + 1;
    totalHours += Number(entry.hours || 0);
    if (!entry.customerCode && entry.taskType !== "社内/その他") invalidNoCustomer += 1;
  });

  console.log(JSON.stringify({
    count: demoEntries.length,
    firstDate: demoEntries.map((entry) => entry.date).sort()[0],
    lastDate: demoEntries.map((entry) => entry.date).sort().at(-1),
    totalHours,
    byMonth,
    byStaff,
    invalidNoCustomer
  }, null, 2));
  process.exit(0);
}

console.log(`Generated ${entries.length} entries.`);

for (let index = 0; index < entries.length; index += batchSize) {
  const batch = entries.slice(index, index + batchSize);
  await request("saveEntries", { entries: batch });
  console.log(`Uploaded ${Math.min(index + batch.length, entries.length)}/${entries.length}`);
}

console.log("Sample worklogs uploaded.");

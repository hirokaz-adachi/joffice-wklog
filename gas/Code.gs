const CONFIG = {
  apiToken: "joffice-wklog-api",
  dashboardCacheKey: "worklog-dashboard-v2",
  dashboardCacheSeconds: 300,
  lockWaitMilliseconds: 20000,
  sheets: {
    worklogs: "worklogs",
    staff: "staff_master",
    customers: "customer_master",
    tasks: "task_master",
    taskPhases: "task_phase_master",
    customerStaff: "customer_staff_master",
    billing: "billing_data",
    targets: "staff_target_master",
    settings: "app_settings"
  },
  headers: {
    // 案2: worklogs に taskCode/phaseCode を追加（末尾に追加して既存列の位置を保つ）
    worklogs: ["id", "date", "staffCode", "staff", "customerCode", "customer", "taskType", "hours", "memo", "updatedAt", "taskCode", "phaseCode"],
    staff: ["code", "name"],
    customers: ["code", "name"],
    // 案2: 業務区分マスタ = 業務コード + 名称 + 配賦区分(service/excluded/tax)
    tasks: ["code", "name", "allocationType"],
    // 案2: 工程マスタ（業務コードごとの Prepare/Review 振分率。ratio は %・役務は合計100）
    taskPhases: ["taskCode", "phaseCode", "phaseName", "ratio", "sortOrder"],
    // 案2: 顧客担当者マスタ（1顧客に複数可。role=工程コード=役割対応フォールバックの寄せ先）
    customerStaff: ["customerCode", "staffCode", "role", "sortOrder", "effectiveFrom"],
    // 案2: billing に invoiceItemCode(業務コード)/transferDate(振替日) を追加（末尾に追加）
    billing: ["invoiceId", "billingMonth", "customerCode", "customer", "invoiceItem", "paymentMethod", "netAmount", "taxAmount", "grossAmount", "issuedDate", "paymentDueDate", "paymentStatus", "memo", "invoiceItemCode", "transferDate"],
    targets: ["targetMonth", "staffCode", "staff", "targetAmount"],
    // 案2: 設定（作業→請求オフセット(イ) 等をキーバリューで保持）
    settings: ["key", "value"]
  },
  defaultSettings: { billingOffset: "0" }
};

// 案2 工程コード（当面 Prepare/Review の2固定。N工程に拡張可）
const PHASES = [
  { code: "PRE", name: "Prepare" },
  { code: "REV", name: "Review" }
];

// 案2 業務区分の確定カタログ（受領資料 【DM】請求品目一覧.xlsx・2026-06-23 櫻井所長回答で確定）
// [code, name, allocationType(service/excluded/tax), prepare%, review%]
// 0/0 の 027/028/060 は配賦対象外（工程比なし＝スタッフ配賦せず・総売上にのみ計上）、080 は税。
// 旧 037/046/100 は廃止。スポット手続は 036 に一本化。
const TASK_CATALOG = [
  ["001", "労務相談",            "service",  100, 0],
  ["002", "事務長代行費用",      "service",  100, 0],
  ["003", "有給休暇管理費用",    "service",  70, 30],
  ["026", "給与計算",            "service",  70, 30],
  ["027", "FBデータ作成費用",    "excluded", 0,  0],
  ["028", "マイナンバー管理料金", "excluded", 0,  0],
  ["036", "スポット手続",        "service",  100, 0],
  ["056", "賞与計算",            "service",  70, 30],
  ["060", "諸費用",              "excluded", 0,  0],
  ["061", "給与支払報告書",      "service",  70, 30],
  ["062", "算定基礎届",          "service",  70, 30],
  ["063", "労働保険年度更新",    "service",  70, 30],
  ["064", "住民税変更",          "service",  70, 30],
  ["065", "年末調整",            "service",  70, 30],
  ["080", "消費税",              "tax",      0,  0]
];

const MASTER_DEFS = {
  staff:     { sheet: CONFIG.sheets.staff,     fields: ["code", "name"], key: "code" },
  customers: { sheet: CONFIG.sheets.customers, fields: ["code", "name"], key: "code" },
  tasks:     { sheet: CONFIG.sheets.tasks,     fields: ["code", "name", "allocationType"], key: "code" }
};

function doGet(e) {
  const callback = (e.parameter.callback || "callback").replace(/[^\w$]/g, "");
  try {
    assertToken_(e.parameter.token || "");
    const action = e.parameter.action || "bootstrap";
    const payload = parsePayload_(e.parameter.payload || "{}");
    const data = route_(action, payload);
    return jsonp_(callback, { ok: true, data });
  } catch (error) {
    return jsonp_(callback, { ok: false, error: String(error.message || error) });
  }
}

function setup() {
  ensureSheets_();
  applyCodeFormats_();
  seedDefaults_();
  invalidateDashboardCache_();
}

// 業務コード列をテキスト書式（@）に固定し、"026" 等の先頭ゼロが数値化で落ちるのを防ぐ。
// setup()/rebuildDemo() の seed 前に呼ぶ。書き込み前に書式を当てることで以後の値はテキスト保持される。
function applyCodeFormats_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const fmt = function (name, col) {
    const sh = ss.getSheetByName(name);
    if (sh && col > 0) sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat("@");
  };
  fmt(CONFIG.sheets.tasks, 1);       // task_master.code
  fmt(CONFIG.sheets.taskPhases, 1);  // task_phase_master.taskCode
  fmt(CONFIG.sheets.worklogs, CONFIG.headers.worklogs.indexOf("taskCode") + 1);
  fmt(CONFIG.sheets.billing, CONFIG.headers.billing.indexOf("invoiceItemCode") + 1);
  fmt(CONFIG.sheets.customerStaff, CONFIG.headers.customerStaff.indexOf("effectiveFrom") + 1); // 有効開始月 "YYYY-MM" をテキスト保持
}

// 案2: 業務区分カタログ・工程・設定をシードし直す（マスタのみ作り直し）。
// 既存のマスタ内容をクリアして TASK_CATALOG / PHASES から再構築する。
function seedTaskCatalog_() {
  const taskSheet = ensureSheet_(CONFIG.sheets.tasks, CONFIG.headers.tasks);
  const phaseSheet = ensureSheet_(CONFIG.sheets.taskPhases, CONFIG.headers.taskPhases);
  clearDataRows_(taskSheet);
  clearDataRows_(phaseSheet);
  // コード列をテキスト書式に固定（setValues は書式を尊重し "026" を保持する。appendRow は数値化するため使わない）。
  taskSheet.getRange(1, 1, taskSheet.getMaxRows(), 1).setNumberFormat("@");
  phaseSheet.getRange(1, 1, phaseSheet.getMaxRows(), 1).setNumberFormat("@");
  const taskRows = [];
  const phaseRows = [];
  TASK_CATALOG.forEach((row) => {
    const code = row[0], name = row[1], allocationType = row[2], prep = row[3], rev = row[4];
    taskRows.push([code, name, allocationType]);
    if (allocationType === "service") {
      phaseRows.push([code, "PRE", "Prepare", prep, 1]);
      phaseRows.push([code, "REV", "Review", rev, 2]);
    }
  });
  if (taskRows.length) taskSheet.getRange(2, 1, taskRows.length, 3).setValues(taskRows);
  if (phaseRows.length) phaseSheet.getRange(2, 1, phaseRows.length, 5).setValues(phaseRows);
}

function route_(action, payload) {
  switch (action) {
    case "bootstrap":
      return bootstrap_();
    case "dashboard":
      return dashboard_(Boolean(payload.forceRefresh));
    case "saveEntry":
      return mutateDashboardData_(() => saveEntry_(payload.entry));
    case "saveEntries":
      return mutateDashboardData_(() => (payload.entries || []).map(saveEntry_));
    case "deleteEntry":
      return mutateDashboardData_(() => {
        deleteById_(CONFIG.sheets.worklogs, payload.id);
        return { id: payload.id };
      });
    case "upsertMaster":
      return mutateDashboardData_(
        () => upsertMaster_(payload.type, payload.item, payload.oldCode || "")
      );
    case "removeMaster":
      return mutateDashboardData_(() => {
        removeMaster_(payload.type, payload.code);
        return { type: payload.type, code: payload.code };
      });
    case "saveBilling":
      return mutateDashboardData_(() => saveBilling_(payload.row));
    case "saveBillings":
      return mutateDashboardData_(() => (payload.rows || []).map(saveBilling_));
    case "deleteBilling":
      return mutateDashboardData_(() => {
        deleteById_(CONFIG.sheets.billing, payload.invoiceId);
        return { invoiceId: payload.invoiceId };
      });
    case "saveTarget":
      return mutateDashboardData_(() => saveTarget_(payload.row));
    case "saveTargets":
      return mutateDashboardData_(() => (payload.rows || []).map(saveTarget_));
    case "deleteTarget":
      return mutateDashboardData_(() => {
        deleteTarget_(payload.targetMonth, payload.staffCode);
        return { targetMonth: payload.targetMonth, staffCode: payload.staffCode };
      });
    // 案2: 工程マスタ
    case "saveTaskPhase":
      return mutateDashboardData_(() => saveTaskPhase_(payload.row));
    case "saveTaskPhases":
      return mutateDashboardData_(() => (payload.rows || []).map(saveTaskPhase_));
    case "deleteTaskPhase":
      return mutateDashboardData_(() => {
        deleteTaskPhase_(payload.taskCode, payload.phaseCode);
        return { taskCode: payload.taskCode, phaseCode: payload.phaseCode };
      });
    // 案2: 顧客担当者マスタ
    case "saveCustomerStaff":
      return mutateDashboardData_(() => saveCustomerStaff_(payload.row));
    case "saveCustomerStaffs":
      return mutateDashboardData_(() => (payload.rows || []).map(saveCustomerStaff_));
    case "deleteCustomerStaff":
      return mutateDashboardData_(() => {
        deleteCustomerStaff_(payload.customerCode, payload.role, payload.effectiveFrom);
        return { customerCode: payload.customerCode, role: payload.role, effectiveFrom: payload.effectiveFrom };
      });
    // 案2: 設定
    case "saveSetting":
      return mutateDashboardData_(() => saveSetting_(payload.key, payload.value));
    default:
      throw new Error("unknown action: " + action);
  }
}

function dashboard_(forceRefresh) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.lockWaitMilliseconds);
  try {
    if (!forceRefresh) {
      const cached = readDashboardCache_();
      if (cached) return cached;
    }

    const data = {
      generatedAt: new Date().toISOString(),
      staff: readObjects_(CONFIG.sheets.staff),
      customers: readObjects_(CONFIG.sheets.customers),
      tasks: readObjectsSafe_(CONFIG.sheets.tasks),
      taskPhases: readObjectsSafe_(CONFIG.sheets.taskPhases).map((row) => ({
        taskCode: String(row.taskCode),
        phaseCode: row.phaseCode,
        phaseName: row.phaseName,
        ratio: Number(row.ratio || 0),
        sortOrder: Number(row.sortOrder || 0)
      })),
      customerStaff: readObjectsSafe_(CONFIG.sheets.customerStaff).map((row) => ({
        customerCode: String(row.customerCode),
        staffCode: String(row.staffCode || ""),
        role: row.role,
        effectiveFrom: formatMonth_(row.effectiveFrom),
        sortOrder: Number(row.sortOrder || 0)
      })),
      settings: readSettings_(),
      entries: readObjects_(CONFIG.sheets.worklogs).map(normalizeWorklog_),
      billing: readObjects_(CONFIG.sheets.billing).map((row) => ({
        invoiceId: row.invoiceId,
        billingMonth: formatMonth_(row.billingMonth),
        customerCode: row.customerCode,
        customer: row.customer,
        invoiceItem: row.invoiceItem,
        invoiceItemCode: String(row.invoiceItemCode == null ? "" : row.invoiceItemCode),
        paymentMethod: row.paymentMethod,
        netAmount: Number(row.netAmount || 0),
        taxAmount: Number(row.taxAmount || 0),
        grossAmount: Number(row.grossAmount || 0),
        transferDate: formatDate_(row.transferDate),
        issuedDate: formatDate_(row.issuedDate),
        paymentDueDate: formatDate_(row.paymentDueDate),
        paymentStatus: row.paymentStatus,
        memo: row.memo
      })),
      targets: readObjects_(CONFIG.sheets.targets).map((row) => ({
        targetMonth: formatMonth_(row.targetMonth),
        staffCode: row.staffCode,
        staff: row.staff,
        targetAmount: Number(row.targetAmount || 0)
      }))
    };
    writeDashboardCache_(data);
    return data;
  } finally {
    lock.releaseLock();
  }
}

function bootstrap_() {
  return {
    staff: readObjects_(CONFIG.sheets.staff),
    customers: readObjects_(CONFIG.sheets.customers),
    tasks: readObjectsSafe_(CONFIG.sheets.tasks),
    taskTypes: readObjectsSafe_(CONFIG.sheets.tasks).map((row) => row.name).filter(Boolean),
    taskPhases: readObjectsSafe_(CONFIG.sheets.taskPhases),
    customerStaff: readObjectsSafe_(CONFIG.sheets.customerStaff).map((row) => ({
      customerCode: String(row.customerCode),
      staffCode: String(row.staffCode || ""),
      role: row.role,
      effectiveFrom: formatMonth_(row.effectiveFrom),
      sortOrder: Number(row.sortOrder || 0)
    })),
    settings: readSettings_(),
    entries: readObjects_(CONFIG.sheets.worklogs).map(normalizeWorklog_)
  };
}

function normalizeWorklog_(row) {
  return {
    id: row.id,
    date: formatDate_(row.date),
    staffCode: row.staffCode,
    staff: row.staff,
    customerCode: row.customerCode,
    customer: row.customer,
    taskType: row.taskType,
    taskCode: String(row.taskCode == null ? "" : row.taskCode),
    phaseCode: row.phaseCode == null ? "" : row.phaseCode,
    hours: Number(row.hours || 0),
    memo: row.memo,
    updatedAt: row.updatedAt
  };
}

function saveEntry_(entry) {
  if (!entry || !entry.id) throw new Error("entry.id is required");
  const sheet = getSheet_(CONFIG.sheets.worklogs);
  const values = CONFIG.headers.worklogs.map((key) => entry[key] == null ? "" : entry[key]);
  const row = findRowByValue_(sheet, 1, entry.id);
  if (row) {
    sheet.getRange(row, 1, 1, values.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
  return entry;
}

function findTargetRow_(sheet, month, staffCode) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (let i = 0; i < values.length; i += 1) {
    if (formatMonth_(values[i][0]) === String(month) && String(values[i][1]) === String(staffCode)) return i + 2;
  }
  return 0;
}

function saveTarget_(row) {
  if (!row || !row.targetMonth || !row.staffCode) throw new Error("target targetMonth/staffCode is required");
  const sheet = getSheet_(CONFIG.sheets.targets);
  const values = CONFIG.headers.targets.map((key) => row[key] == null ? "" : row[key]);
  const r = findTargetRow_(sheet, row.targetMonth, row.staffCode);
  if (r) {
    sheet.getRange(r, 1, 1, values.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
  return row;
}

function deleteTarget_(month, staffCode) {
  const sheet = getSheet_(CONFIG.sheets.targets);
  const r = findTargetRow_(sheet, month, staffCode);
  if (r) sheet.deleteRow(r);
}

function saveBilling_(row) {
  if (!row || !row.invoiceId) throw new Error("billing.invoiceId is required");
  const sheet = getSheet_(CONFIG.sheets.billing);
  const values = CONFIG.headers.billing.map((key) => row[key] == null ? "" : row[key]);
  const r = findRowByValue_(sheet, 1, row.invoiceId);
  if (r) {
    sheet.getRange(r, 1, 1, values.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
  return row;
}

// 案2: 工程マスタ（複合キー taskCode + phaseCode）
function saveTaskPhase_(row) {
  if (!row || !row.taskCode || !row.phaseCode) throw new Error("taskPhase taskCode/phaseCode is required");
  const sheet = ensureSheet_(CONFIG.sheets.taskPhases, CONFIG.headers.taskPhases);
  const values = CONFIG.headers.taskPhases.map((key) => row[key] == null ? "" : row[key]);
  const r = findRowByTwo_(sheet, 1, row.taskCode, 2, row.phaseCode);
  if (r) {
    sheet.getRange(r, 1, 1, values.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
  return row;
}

function deleteTaskPhase_(taskCode, phaseCode) {
  const sheet = getSheet_(CONFIG.sheets.taskPhases);
  const r = findRowByTwo_(sheet, 1, taskCode, 2, phaseCode);
  if (r) sheet.deleteRow(r);
}

// 案2: 顧客担当者マスタ（複合キー customerCode + staffCode）
// 顧客担当（時系列）。同一(顧客,役割,有効開始月)を upsert。staffCode 空=担当解除（tombstone）も許容。
function saveCustomerStaff_(row) {
  if (!row || !row.customerCode || !row.role) throw new Error("customerStaff customerCode/role is required");
  const sheet = ensureSheet_(CONFIG.sheets.customerStaff, CONFIG.headers.customerStaff);
  const cCol = CONFIG.headers.customerStaff.indexOf("customerCode") + 1;
  const rCol = CONFIG.headers.customerStaff.indexOf("role") + 1;
  const eCol = CONFIG.headers.customerStaff.indexOf("effectiveFrom") + 1;
  // 有効開始月 "YYYY-MM" を日付に化けさせないようテキスト書式で固定（setValues は書式を尊重）。
  sheet.getRange(1, eCol, sheet.getMaxRows(), 1).setNumberFormat("@");
  const eff = row.effectiveFrom == null ? "" : String(row.effectiveFrom);
  const values = CONFIG.headers.customerStaff.map((key) => (key === "effectiveFrom" ? eff : (row[key] == null ? "" : row[key])));
  const r = findRowByThree_(sheet, cCol, row.customerCode, rCol, row.role, eCol, eff) || (sheet.getLastRow() + 1);
  sheet.getRange(r, 1, 1, values.length).setValues([values]);
  return row;
}

function deleteCustomerStaff_(customerCode, role, effectiveFrom) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.sheets.customerStaff);
  if (!sheet) return;
  const cCol = CONFIG.headers.customerStaff.indexOf("customerCode") + 1;
  const rCol = CONFIG.headers.customerStaff.indexOf("role") + 1;
  const eCol = CONFIG.headers.customerStaff.indexOf("effectiveFrom") + 1;
  const r = findRowByThree_(sheet, cCol, customerCode, rCol, role, eCol, effectiveFrom == null ? "" : String(effectiveFrom));
  if (r) sheet.deleteRow(r);
}

// 案2: 設定（キーバリュー・upsert）
function saveSetting_(key, value) {
  if (!key) throw new Error("setting key is required");
  const sheet = ensureSheet_(CONFIG.sheets.settings, CONFIG.headers.settings);
  const r = findRowByValue_(sheet, 1, key);
  if (r) {
    sheet.getRange(r, 1, 1, 2).setValues([[key, value]]);
  } else {
    sheet.appendRow([key, value]);
  }
  return { key: key, value: value };
}

function readSettings_() {
  const rows = readObjectsSafe_(CONFIG.sheets.settings);
  const out = {};
  Object.keys(CONFIG.defaultSettings).forEach((k) => { out[k] = CONFIG.defaultSettings[k]; });
  rows.forEach((row) => {
    if (row.key != null && row.key !== "") out[String(row.key)] = String(row.value == null ? "" : row.value);
  });
  return out;
}

function upsertMaster_(type, item, oldCode) {
  const def = MASTER_DEFS[type];
  if (!def) throw new Error("unknown master type: " + type);
  if (!item) throw new Error("master item is required");
  const keyVal = item[def.key];
  if (!keyVal) throw new Error("master " + def.key + " is required");
  if (def.fields.indexOf("name") >= 0 && !item.name) throw new Error("master name is required");
  const sheet = ensureSheet_(def.sheet, def.fields);
  if (oldCode && oldCode !== keyVal) {
    const oldRow = findRowByValue_(sheet, 1, oldCode);
    if (oldRow) sheet.deleteRow(oldRow);
  }
  const values = def.fields.map((f) => item[f] == null ? "" : item[f]);
  const row = findRowByValue_(sheet, 1, keyVal);
  if (row) {
    sheet.getRange(row, 1, 1, values.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
  return item;
}

function removeMaster_(type, code) {
  const def = MASTER_DEFS[type];
  if (!def) throw new Error("unknown master type: " + type);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(def.sheet);
  if (!sheet) return;
  const row = findRowByValue_(sheet, 1, code);
  if (row) sheet.deleteRow(row);
}

function deleteById_(sheetName, id) {
  if (!id) return;
  const sheet = getSheet_(sheetName);
  const row = findRowByValue_(sheet, 1, id);
  if (row) sheet.deleteRow(row);
}

function ensureSheets_() {
  ensureSheet_(CONFIG.sheets.worklogs, CONFIG.headers.worklogs);
  ensureSheet_(CONFIG.sheets.staff, CONFIG.headers.staff);
  ensureSheet_(CONFIG.sheets.customers, CONFIG.headers.customers);
  ensureSheet_(CONFIG.sheets.tasks, CONFIG.headers.tasks);
  ensureSheet_(CONFIG.sheets.taskPhases, CONFIG.headers.taskPhases);
  ensureSheet_(CONFIG.sheets.customerStaff, CONFIG.headers.customerStaff);
  ensureSheet_(CONFIG.sheets.billing, CONFIG.headers.billing);
  ensureSheet_(CONFIG.sheets.targets, CONFIG.headers.targets);
  ensureSheet_(CONFIG.sheets.settings, CONFIG.headers.settings);
}

function readDashboardCache_() {
  const cache = CacheService.getScriptCache();
  const encoded = cache.get(CONFIG.dashboardCacheKey);
  if (!encoded) return null;
  try {
    const compressed = Utilities.newBlob(Utilities.base64Decode(encoded));
    const json = Utilities.ungzip(compressed).getDataAsString("UTF-8");
    return JSON.parse(json);
  } catch (error) {
    cache.remove(CONFIG.dashboardCacheKey);
    return null;
  }
}

function writeDashboardCache_(data) {
  try {
    const json = JSON.stringify(data);
    const compressed = Utilities.gzip(Utilities.newBlob(json, "application/json"));
    const encoded = Utilities.base64Encode(compressed.getBytes());
    if (encoded.length > 95000) return;
    CacheService.getScriptCache().put(
      CONFIG.dashboardCacheKey,
      encoded,
      CONFIG.dashboardCacheSeconds
    );
  } catch (error) {
    console.warn("dashboard cache write failed: " + error);
  }
}

function invalidateDashboardCache_() {
  CacheService.getScriptCache().remove(CONFIG.dashboardCacheKey);
}

function mutateDashboardData_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(CONFIG.lockWaitMilliseconds);
  try {
    return callback();
  } finally {
    invalidateDashboardCache_();
    lock.releaseLock();
  }
}

function seedDefaults_() {
  // 案2: 業務区分カタログ・工程をシード（空のときのみ）。
  const tasks = getSheet_(CONFIG.sheets.tasks);
  if (tasks.getLastRow() <= 1) {
    seedTaskCatalog_();
  }
  // 設定の既定値（billingOffset 等）を初期投入。
  const settings = ensureSheet_(CONFIG.sheets.settings, CONFIG.headers.settings);
  if (settings.getLastRow() <= 1) {
    Object.keys(CONFIG.defaultSettings).forEach((k) => settings.appendRow([k, CONFIG.defaultSettings[k]]));
  }
}

function ensureSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeader = headers.some((header, index) => current[index] !== header);
  if (needsHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// データ行（ヘッダー以外）をクリアする。
function clearDataRows_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow > 1 && lastCol > 0) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }
}

function getSheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) {
    throw new Error("required sheet is missing: " + name + ". Run setup() first.");
  }
  return sheet;
}

function readObjectsSafe_(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return [];
  return readObjects_(sheetName);
}

function readObjects_(sheetName) {
  const sheet = getSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  return values.slice(1).filter((row) => row.some((cell) => cell !== "")).map((row) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  });
}

function findRowByValue_(sheet, column, value) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const values = sheet.getRange(2, column, lastRow - 1, 1).getValues();
  for (let index = 0; index < values.length; index += 1) {
    if (String(values[index][0]) === String(value)) return index + 2;
  }
  return 0;
}

// 2列の複合キーで行を探す（工程マスタ用）。
function findRowByTwo_(sheet, col1, val1, col2, val2) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const width = Math.max(col1, col2);
  const values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  for (let i = 0; i < values.length; i += 1) {
    if (String(values[i][col1 - 1]) === String(val1) && String(values[i][col2 - 1]) === String(val2)) return i + 2;
  }
  return 0;
}

// 3列の複合キーで行を探す（顧客担当: 顧客・役割・有効開始月）。有効開始月は formatMonth_ 相当に揃えて比較。
function findRowByThree_(sheet, c1, v1, c2, v2, c3, v3) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const width = Math.max(c1, c2, c3);
  const values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  for (let i = 0; i < values.length; i += 1) {
    if (String(values[i][c1 - 1]) === String(v1)
      && String(values[i][c2 - 1]) === String(v2)
      && formatMonth_(values[i][c3 - 1]) === String(v3)) return i + 2;
  }
  return 0;
}

function masterSheetName_(type) {
  if (type === "staff") return CONFIG.sheets.staff;
  if (type === "customers") return CONFIG.sheets.customers;
  throw new Error("unknown master type: " + type);
}

function assertToken_(token) {
  if (CONFIG.apiToken && token !== CONFIG.apiToken) throw new Error("invalid token");
}

function parsePayload_(value) {
  return JSON.parse(value || "{}");
}

function formatDate_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(value || "").replace(/\//g, "-").slice(0, 10);
}

function formatMonth_(value) {
  return formatDate_(value).slice(0, 7);
}

function jsonp_(callback, value) {
  return ContentService
    .createTextOutput(callback + "(" + JSON.stringify(value) + ");")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

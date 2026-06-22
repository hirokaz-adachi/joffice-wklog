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
    billing: "billing_data",
    targets: "staff_target_master",
    items: "item_master"
  },
  headers: {
    worklogs: ["id", "date", "staffCode", "staff", "customerCode", "customer", "taskType", "hours", "memo", "updatedAt"],
    staff: ["code", "name"],
    customers: ["code", "name"],
    tasks: ["name"],
    billing: ["invoiceId", "billingMonth", "customerCode", "customer", "invoiceItem", "paymentMethod", "netAmount", "taxAmount", "grossAmount", "issuedDate", "paymentDueDate", "paymentStatus", "memo"],
    targets: ["targetMonth", "staffCode", "staff", "targetAmount"],
    items: ["code", "name"]
  },
  defaultTasks: ["顧問対応", "給与計算", "手続き", "労務相談", "助成金", "スポット", "社内/その他"]
};

const MASTER_DEFS = {
  staff:     { sheet: CONFIG.sheets.staff,     fields: ["code", "name"], key: "code" },
  customers: { sheet: CONFIG.sheets.customers, fields: ["code", "name"], key: "code" },
  tasks:     { sheet: CONFIG.sheets.tasks,     fields: ["name"],         key: "name" },
  items:     { sheet: CONFIG.sheets.items,     fields: ["code", "name"], key: "code" }
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
  seedDefaults_();
  invalidateDashboardCache_();
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
      entries: readObjects_(CONFIG.sheets.worklogs).map(normalizeWorklog_),
      billing: readObjects_(CONFIG.sheets.billing).map((row) => ({
        invoiceId: row.invoiceId,
        billingMonth: formatMonth_(row.billingMonth),
        customerCode: row.customerCode,
        customer: row.customer,
        invoiceItem: row.invoiceItem,
        paymentMethod: row.paymentMethod,
        netAmount: Number(row.netAmount || 0),
        taxAmount: Number(row.taxAmount || 0),
        grossAmount: Number(row.grossAmount || 0),
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
    taskTypes: readObjects_(CONFIG.sheets.tasks).map((row) => row.name).filter(Boolean),
    items: readObjectsSafe_(CONFIG.sheets.items),
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
  ensureSheet_(CONFIG.sheets.billing, CONFIG.headers.billing);
  ensureSheet_(CONFIG.sheets.targets, CONFIG.headers.targets);
  ensureSheet_(CONFIG.sheets.items, CONFIG.headers.items);
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
  const tasks = getSheet_(CONFIG.sheets.tasks);
  if (tasks.getLastRow() === 1) {
    CONFIG.defaultTasks.forEach((name) => tasks.appendRow([name]));
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

// joffice-pro APIクライアント（JSONP廃止・同一オリジン fetch + セッションCookie）。
// action 名・ペイロードは GAS 版を踏襲。更新系は CSRF トークンを付与する。
const JO_API = 'api.php';
let JO_CSRF = null;

async function joCall(action, params = {}, method = 'GET') {
  const opts = { method, credentials: 'same-origin', headers: {} };
  let url = JO_API + '?action=' + encodeURIComponent(action);

  if (method === 'GET') {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += '&' + qs;
  } else {
    opts.headers['Content-Type'] = 'application/json';
    if (JO_CSRF) opts.headers['X-CSRF-Token'] = JO_CSRF;
    opts.body = JSON.stringify(params);
  }

  const res = await fetch(url, opts);
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = { ok: false, error: 'bad_json' };
  }
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || ('http_' + res.status));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// 認証系
async function joLogin(loginId, password) {
  const r = await joCall('login', { loginId, password }, 'POST');
  JO_CSRF = r.csrf;
  return r.user;
}
async function joMe() {
  const r = await joCall('me');
  JO_CSRF = r.csrf;
  return r.user;
}
async function joLogout() {
  const r = await joCall('logout', {}, 'POST');
  JO_CSRF = null;
  return r;
}
async function joPing() {
  return joCall('ping');
}

// 参照系：bootstrap（マスタ＋工数）。要ログイン。data を返す。
async function joBootstrap() {
  const r = await joCall('bootstrap');
  return r.data;
}

// 更新系（action名は GAS 踏襲・POST・CSRF自動付与）。いずれも data を返す。
async function joWrite(action, params) { const r = await joCall(action, params, 'POST'); return r.data; }

// 工数
const joSaveEntry    = (entry)   => joWrite('saveEntry', { entry });
const joSaveEntries  = (entries) => joWrite('saveEntries', { entries });
const joDeleteEntry  = (id)      => joWrite('deleteEntry', { id });
// 請求
const joSaveBilling  = (row)     => joWrite('saveBilling', { row });
const joSaveBillings = (rows)    => joWrite('saveBillings', { rows });
const joDeleteBilling = (invoiceId) => joWrite('deleteBilling', { invoiceId });
// 売上目標
const joSaveTarget   = (row)     => joWrite('saveTarget', { row });
const joSaveTargets  = (rows)    => joWrite('saveTargets', { rows });
const joDeleteTarget = (targetMonth, staffCode) => joWrite('deleteTarget', { targetMonth, staffCode });
// マスタ（staff/customers/tasks）
const joUpsertMaster = (type, item, oldCode = '') => joWrite('upsertMaster', { type, item, oldCode });
const joRemoveMaster = (type, code) => joWrite('removeMaster', { type, code });
// 工程
const joSaveTaskPhase  = (row)  => joWrite('saveTaskPhase', { row });
const joSaveTaskPhases = (rows) => joWrite('saveTaskPhases', { rows });
const joDeleteTaskPhase = (taskCode, phaseCode) => joWrite('deleteTaskPhase', { taskCode, phaseCode });
// 顧客担当（時系列）
const joSaveCustomerStaff  = (row)  => joWrite('saveCustomerStaff', { row });
const joSaveCustomerStaffs = (rows) => joWrite('saveCustomerStaffs', { rows });
const joDeleteCustomerStaff = (customerCode, role, effectiveFrom) => joWrite('deleteCustomerStaff', { customerCode, role, effectiveFrom });
// 設定
const joSaveSetting = (key, value) => joWrite('saveSetting', { key, value });

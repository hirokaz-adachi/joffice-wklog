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
  window.JO_USER = r.user;
  return r.user;
}
async function joMe() {
  const r = await joCall('me');
  JO_CSRF = r.csrf;
  window.JO_USER = r.user;
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

// ユーザー管理（admin）／パスワード変更（本人）
const joListUsers = () => joCall('listUsers').then((r) => r.data);
const joSaveUser = (user) => joWrite('saveUser', { user });
const joDeleteUser = (id) => joWrite('deleteUser', { id });
const joChangePassword = (current, next) => joWrite('changePassword', { current, next });

// ---- 旧 WorklogBackend 互換シム ----
// 既存画面（master.js 等）はインクルード差し替えのみで再利用するため、
// GAS版 backend.js と同じ window.WorklogBackend API を fetch 実装で提供する。
window.WorklogBackend = {
  isRemote: () => true,
  loadState: () => joBootstrap(),
  loadDashboard: (force) => joCall('dashboard', { forceRefresh: !!force }).then((r) => r.data),
  saveEntry: joSaveEntry,
  saveEntries: joSaveEntries,
  deleteEntry: joDeleteEntry,
  saveBilling: joSaveBilling,
  saveBillings: joSaveBillings,
  deleteBilling: joDeleteBilling,
  saveTarget: joSaveTarget,
  saveTargets: joSaveTargets,
  deleteTarget: joDeleteTarget,
  upsertMaster: joUpsertMaster,
  removeMaster: joRemoveMaster,
  saveTaskPhase: joSaveTaskPhase,
  saveTaskPhases: joSaveTaskPhases,
  deleteTaskPhase: joDeleteTaskPhase,
  saveCustomerStaff: joSaveCustomerStaff,
  saveCustomerStaffs: joSaveCustomerStaffs,
  deleteCustomerStaff: joDeleteCustomerStaff,
  saveSetting: joSaveSetting,
};

// 全画面共通：ヘッダにログインユーザー（ID・名称・役割）を表示する。
(function () {
  function badge(u) {
    return 'ログイン中: ' + u.loginId + (u.displayName ? ' ' + u.displayName : '') + '（' + u.role + '）';
  }
  function inject() {
    // 横並びのアクション領域（.top-actions / .header-nav）優先。無ければ header に縦積み。
    var inlineBar = document.querySelector('.top-actions') || document.querySelector('.header-nav');
    var header = inlineBar || document.querySelector('header');
    if (!header) return;
    joMe().then(function (u) {
      var el = document.getElementById('whoami');
      if (!el) {
        el = document.createElement('span');
        el.id = 'whoami';
        if (inlineBar) {
          el.style.cssText = 'font-size:12px;color:#6b7280;white-space:nowrap;align-self:center;';
          inlineBar.insertBefore(el, inlineBar.firstChild);
        } else {
          el.style.cssText = 'display:block;font-size:12px;color:#6b7280;margin-top:4px;';
          header.appendChild(el);
        }
      }
      el.textContent = badge(u);
    }).catch(function () { /* 未ログインはガード側で処理 */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();

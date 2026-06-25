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

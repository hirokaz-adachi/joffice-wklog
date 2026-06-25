<?php
// 認証・セッション・RBAC・CSRF。
declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/helpers.php';

// セッション開始（httpOnly / SameSite=Lax / Secure は設定依存）。
function jo_session_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    session_name('JOSESSID');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => (bool) jo_config('cookie_secure'),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function jo_current_user(): ?array
{
    return $_SESSION['user'] ?? null;
}

function jo_require_login(): array
{
    $u = jo_current_user();
    if (!$u) {
        jo_error('unauthorized', 401);
    }
    return $u;
}

// 指定ロールのいずれかを要求する。
function jo_require_role(array $roles): array
{
    $u = jo_require_login();
    if (!in_array($u['role'], $roles, true)) {
        jo_error('forbidden', 403);
    }
    return $u;
}

function jo_csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
    return $_SESSION['csrf'];
}

// 更新系で呼ぶ。ヘッダ X-CSRF-Token か body の csrf を検証。
function jo_check_csrf(array $in): void
{
    $t = $in['csrf'] ?? ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    if (!hash_equals((string) ($_SESSION['csrf'] ?? ''), (string) $t)) {
        jo_error('csrf_mismatch', 419);
    }
}

// ログイン。成功でセッションへユーザーを格納し、セッション情報を返す。
function jo_login(string $loginId, string $password): array
{
    $db = jo_db();
    $st = $db->prepare('SELECT * FROM jo_users WHERE loginId = ? LIMIT 1');
    $st->execute([$loginId]);
    $user = $st->fetch();

    $now = new DateTime();

    if (!$user || !(int) $user['isActive']) {
        jo_error('invalid_credentials', 401);
    }
    if (!empty($user['lockedUntil']) && new DateTime($user['lockedUntil']) > $now) {
        jo_error('account_locked', 423);
    }

    if (!password_verify($password, $user['passwordHash'])) {
        $fa = (int) $user['failedAttempts'] + 1;
        $lock = null;
        if ($fa >= 5) {
            $lock = (clone $now)->modify('+15 minutes')->format('Y-m-d H:i:s');
            $fa = 0;
        }
        $db->prepare('UPDATE jo_users SET failedAttempts = ?, lockedUntil = ? WHERE id = ?')
           ->execute([$fa, $lock, $user['id']]);
        jo_error('invalid_credentials', 401);
    }

    // 成功：失敗回数リセット・最終ログイン更新
    $db->prepare('UPDATE jo_users SET failedAttempts = 0, lockedUntil = NULL, lastLoginAt = NOW() WHERE id = ?')
       ->execute([$user['id']]);

    // セッション固定攻撃対策：ID再生成してから格納
    session_regenerate_id(true);
    $sess = [
        'id'                 => (int) $user['id'],
        'loginId'            => $user['loginId'],
        'role'               => $user['role'],
        'staffCode'          => $user['staffCode'],
        'displayName'        => $user['displayName'],
        'mustChangePassword' => (int) $user['mustChangePassword'],
    ];
    $_SESSION['user'] = $sess;
    return $sess;
}

function jo_logout(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'] ?? '', (bool) $p['secure'], (bool) $p['httponly']);
    }
    session_destroy();
}

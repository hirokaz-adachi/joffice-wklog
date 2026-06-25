<?php
// JOfficeInvoice / Insight (pro) フロントコントローラ。
// JSONP は廃止。同一オリジン fetch + セッションCookie。
// action 名は GAS 版を踏襲し、backend.js の差し替えだけで画面を再利用する。
declare(strict_types=1);

require_once __DIR__ . '/lib/helpers.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/handlers.php';

jo_session_start();

$in = jo_input();
$action = (string) ($in['action'] ?? '');

try {
    switch ($action) {

        // --- ヘルスチェック（認証不要）---
        case 'ping':
            $dbOk = false;
            try {
                jo_db()->query('SELECT 1');
                $dbOk = true;
            } catch (Throwable $e) {
                $dbOk = false;
            }
            jo_json([
                'ok'   => true,
                'php'  => PHP_VERSION,
                'db'   => $dbOk,
                'env'  => jo_config('env'),
                'time' => date('c'),
            ]);
            break;

        // --- 認証 ---
        case 'login':
            $user = jo_login((string) ($in['loginId'] ?? ''), (string) ($in['password'] ?? ''));
            jo_json(['ok' => true, 'user' => $user, 'csrf' => jo_csrf_token()]);
            break;

        case 'logout':
            jo_logout();
            jo_json(['ok' => true]);
            break;

        case 'me':
            $user = jo_require_login();
            jo_json(['ok' => true, 'user' => $user, 'csrf' => jo_csrf_token()]);
            break;

        // --- 参照系 ---
        case 'bootstrap':
            $user = jo_require_login();
            jo_json(['ok' => true, 'data' => jo_handle_bootstrap($user)]);
            break;

        // --- 以降、dashboard / save* などを順次追加 ---

        default:
            jo_error('unknown_action: ' . $action, 404);
    }
} catch (Throwable $e) {
    $extra = jo_is_debug() ? ['detail' => $e->getMessage()] : [];
    jo_error('server_error', 500, $extra);
}

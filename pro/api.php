<?php
// JOfficeInvoice / Insight (pro) フロントコントローラ。
// JSONP は廃止。同一オリジン fetch + セッションCookie。
// action 名は GAS 版を踏襲し、backend.js の差し替えだけで画面を再利用する。
declare(strict_types=1);

require_once __DIR__ . '/lib/helpers.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/handlers.php';
require_once __DIR__ . '/lib/mutations.php';

// staff ロールは自分の工数のみ操作可
function jo_assert_entry_owner(array $user, $entry): void
{
    if (($user['role'] ?? '') === 'staff') {
        $sc = is_array($entry) ? (string) ($entry['staffCode'] ?? '') : '';
        if ($sc !== (string) ($user['staffCode'] ?? '')) {
            jo_error('forbidden_other_staff', 403);
        }
    }
}

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

        // --- 更新系：工数（本人 or 管理者/マネージャ）---
        case 'saveEntry': {
            $user = jo_require_login();
            jo_check_csrf($in);
            $entry = $in['entry'] ?? [];
            jo_assert_entry_owner($user, $entry);
            jo_json(['ok' => true, 'data' => jo_save_entry($entry)]);
            break;
        }
        case 'saveEntries': {
            $user = jo_require_login();
            jo_check_csrf($in);
            $res = [];
            foreach (($in['entries'] ?? []) as $e) {
                jo_assert_entry_owner($user, $e);
                $res[] = jo_save_entry($e);
            }
            jo_json(['ok' => true, 'data' => $res]);
            break;
        }
        case 'deleteEntry': {
            $user = jo_require_login();
            jo_check_csrf($in);
            $id = (string) ($in['id'] ?? '');
            if (($user['role'] ?? '') === 'staff') {
                $row = jo_rows('SELECT staffCode FROM jo_worklogs WHERE id = ?', [$id]);
                if ($row && (string) $row[0]['staffCode'] !== (string) ($user['staffCode'] ?? '')) {
                    jo_error('forbidden_other_staff', 403);
                }
            }
            jo_delete_entry($id);
            jo_json(['ok' => true, 'data' => ['id' => $id]]);
            break;
        }

        // --- 更新系：請求・目標・各マスタ・設定（管理者のみ）---
        case 'saveBilling':
            jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_json(['ok' => true, 'data' => jo_save_billing($in['row'] ?? [])]);
            break;
        case 'saveBillings':
            jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_json(['ok' => true, 'data' => array_map('jo_save_billing', $in['rows'] ?? [])]);
            break;
        case 'deleteBilling':
            jo_require_role(['admin']);
            jo_check_csrf($in);
            $iid = (string) ($in['invoiceId'] ?? '');
            jo_delete_billing($iid);
            jo_json(['ok' => true, 'data' => ['invoiceId' => $iid]]);
            break;

        case 'saveTarget':
            jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_json(['ok' => true, 'data' => jo_save_target($in['row'] ?? [])]);
            break;
        case 'saveTargets':
            jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_json(['ok' => true, 'data' => array_map('jo_save_target', $in['rows'] ?? [])]);
            break;
        case 'deleteTarget':
            jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_delete_target((string) ($in['targetMonth'] ?? ''), (string) ($in['staffCode'] ?? ''));
            jo_json(['ok' => true, 'data' => ['targetMonth' => $in['targetMonth'] ?? '', 'staffCode' => $in['staffCode'] ?? '']]);
            break;

        case 'upsertMaster':
            jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_json(['ok' => true, 'data' => jo_upsert_master((string) ($in['type'] ?? ''), $in['item'] ?? [], (string) ($in['oldCode'] ?? ''))]);
            break;
        case 'removeMaster':
            jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_remove_master((string) ($in['type'] ?? ''), (string) ($in['code'] ?? ''));
            jo_json(['ok' => true, 'data' => ['type' => $in['type'] ?? '', 'code' => $in['code'] ?? '']]);
            break;

        case 'saveTaskPhase':
            jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_json(['ok' => true, 'data' => jo_save_task_phase($in['row'] ?? [])]);
            break;
        case 'saveTaskPhases':
            jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_json(['ok' => true, 'data' => array_map('jo_save_task_phase', $in['rows'] ?? [])]);
            break;
        case 'deleteTaskPhase':
            jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_delete_task_phase((string) ($in['taskCode'] ?? ''), (string) ($in['phaseCode'] ?? ''));
            jo_json(['ok' => true, 'data' => ['taskCode' => $in['taskCode'] ?? '', 'phaseCode' => $in['phaseCode'] ?? '']]);
            break;

        case 'saveCustomerStaff':
            jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_json(['ok' => true, 'data' => jo_save_customer_staff($in['row'] ?? [])]);
            break;
        case 'saveCustomerStaffs':
            jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_json(['ok' => true, 'data' => array_map('jo_save_customer_staff', $in['rows'] ?? [])]);
            break;
        case 'deleteCustomerStaff':
            jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_delete_customer_staff((string) ($in['customerCode'] ?? ''), (string) ($in['role'] ?? ''), (string) ($in['effectiveFrom'] ?? ''));
            jo_json(['ok' => true, 'data' => ['customerCode' => $in['customerCode'] ?? '', 'role' => $in['role'] ?? '', 'effectiveFrom' => $in['effectiveFrom'] ?? '']]);
            break;

        case 'saveSetting':
            jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_json(['ok' => true, 'data' => jo_save_setting((string) ($in['key'] ?? ''), $in['value'] ?? null)]);
            break;

        default:
            jo_error('unknown_action: ' . $action, 404);
    }
} catch (Throwable $e) {
    $extra = jo_is_debug() ? ['detail' => $e->getMessage()] : [];
    jo_error('server_error', 500, $extra);
}

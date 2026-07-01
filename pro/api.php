<?php
// JOfficeInvoice / Insight (pro) フロントコントローラ。
// JSONP は廃止。同一オリジン fetch + セッションCookie。
// action 名は GAS 版を踏襲し、backend.js の差し替えだけで画面を再利用する。
declare(strict_types=1);

require_once __DIR__ . '/lib/helpers.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/handlers.php';
require_once __DIR__ . '/lib/mutations.php';
require_once __DIR__ . '/lib/users.php';
require_once __DIR__ . '/lib/invoices.php';

// 管理者以外（manager/staff）は自分の工数のみ操作可
function jo_assert_entry_owner(array $user, $entry): void
{
    if (($user['role'] ?? '') !== 'admin') {
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

        case 'dashboard':
            $user = jo_require_role(['admin', 'manager']);
            jo_json(['ok' => true, 'data' => jo_handle_dashboard($user)]);
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
            if (($user['role'] ?? '') !== 'admin') {
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

        // --- ユーザー管理（admin）／パスワード変更（本人）---
        case 'listUsers':
            jo_require_role(['admin']);
            jo_json(['ok' => true, 'data' => jo_list_users()]);
            break;
        case 'saveUser':
            $admin = jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_json(['ok' => true, 'data' => jo_save_user($in['user'] ?? [], $admin)]);
            break;
        case 'deleteUser':
            $admin = jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_delete_user((int) ($in['id'] ?? 0), $admin);
            jo_json(['ok' => true, 'data' => ['id' => (int) ($in['id'] ?? 0)]]);
            break;
        case 'changePassword':
            $user = jo_require_login();
            jo_check_csrf($in);
            $r = jo_change_password($user, (string) ($in['current'] ?? ''), (string) ($in['next'] ?? ''));
            $_SESSION['user']['mustChangePassword'] = 0;
            jo_json(['ok' => true, 'data' => $r]);
            break;

        // --- 請求書発行（JOfficeInvoice・admin）---
        case 'listInvoices':
            jo_require_role(['admin']);
            jo_json(['ok' => true, 'data' => jo_list_invoices([
                'billingMonth' => $in['billingMonth'] ?? '',
                'customerCode' => $in['customerCode'] ?? '',
                'status'       => $in['status'] ?? '',
            ])]);
            break;
        case 'getInvoice':
            jo_require_role(['admin']);
            $inv = jo_get_invoice((string) ($in['invoiceNo'] ?? ''));
            if ($inv === null) {
                jo_error('invoice_not_found', 404);
            }
            jo_json(['ok' => true, 'data' => $inv]);
            break;
        case 'saveInvoiceDraft':
            $u = jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_json(['ok' => true, 'data' => jo_save_invoice_draft($in['invoice'] ?? [], $u)]);
            break;
        case 'issueInvoice':
            $u = jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_json(['ok' => true, 'data' => jo_issue_invoice((string) ($in['invoiceNo'] ?? ''), $u)]);
            break;
        case 'voidInvoice':
            $u = jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_json(['ok' => true, 'data' => jo_void_invoice((string) ($in['invoiceNo'] ?? ''), $u)]);
            break;
        case 'duplicateInvoice':
            $u = jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_json(['ok' => true, 'data' => jo_duplicate_invoice((string) ($in['invoiceNo'] ?? ''), $in['overrides'] ?? [], $u)]);
            break;
        case 'deleteInvoiceDraft':
            jo_require_role(['admin']);
            jo_check_csrf($in);
            jo_delete_invoice_draft((string) ($in['invoiceNo'] ?? ''));
            jo_json(['ok' => true, 'data' => ['invoiceNo' => (string) ($in['invoiceNo'] ?? '')]]);
            break;

        // 請求書 PDF（mPDF サーバ生成・GET・admin）。新規タブ表示/ダウンロード用のため JSON ではなく PDF を返す。
        case 'getInvoicePdf':
            jo_require_role(['admin']);
            $no  = (string) ($in['invoiceNo'] ?? '');
            $inv = jo_get_invoice($no);
            if ($inv === null) {
                jo_error('invoice_not_found', 404);
            }
            require_once __DIR__ . '/lib/invoice_pdf.php';
            $settings = jo_app_settings();
            // 検証QRのベースURL：設定があれば優先、なければ現在のホスト/ディレクトリから導出（verify.php は同ディレクトリ）
            $verifyBase = (string) ($settings['invoice.verifyBaseUrl'] ?? '');
            if ($verifyBase === '') {
                $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
                $host   = (string) ($_SERVER['HTTP_HOST'] ?? '');
                $dir    = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? ''))), '/');
                if ($host !== '') { $verifyBase = $scheme . '://' . $host . $dir; }
            }
            $pdf    = jo_render_invoice_pdf($inv['header'], $inv['lines'], $settings, ['dest' => 'S', 'verifyBase' => $verifyBase]);
            $fnSafe = preg_replace('/[^A-Za-z0-9_\-]/', '_', $no);
            $disp   = !empty($in['dl']) ? 'attachment' : 'inline';
            header('Content-Type: application/pdf');
            header('Content-Disposition: ' . $disp . '; filename="invoice-' . $fnSafe . '.pdf"');
            header('Content-Length: ' . strlen($pdf));
            header('Cache-Control: private, no-store');
            echo $pdf;
            break;

        default:
            jo_error('unknown_action: ' . $action, 404);
    }
} catch (InvalidArgumentException $e) {
    // 入力検証・運用ガード違反は 400 で理由コードを返す（フロントが日本語化）
    jo_error('bad_request', 400, ['detail' => $e->getMessage()]);
} catch (JoConflictException $e) {
    // 整合性の衝突（参照あり削除・重複紐付け）は 409 で内訳付きで返す
    jo_error('conflict', 409, array_merge(['detail' => $e->getMessage()], $e->info));
} catch (PDOException $e) {
    // 事前チェックを潜り抜けたDB制約違反（FK/UNIQUE 等）の保険。本番では内部詳細を出さない。
    if ($e->getCode() === '23000') {
        jo_error('conflict', 409, array_merge(['detail' => 'constraint_violation'], jo_is_debug() ? ['raw' => $e->getMessage()] : []));
    }
    jo_error('server_error', 500, jo_is_debug() ? ['detail' => $e->getMessage()] : []);
} catch (Throwable $e) {
    $extra = jo_is_debug() ? ['detail' => $e->getMessage()] : [];
    jo_error('server_error', 500, $extra);
}

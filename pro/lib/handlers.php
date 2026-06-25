<?php
// 参照系ハンドラ。GAS 版（Code.gs）のレスポンス形を踏襲する。
// 集計・配賦はクライアント（allocation.js）側で行うため、ここでは生データを返すだけ。
declare(strict_types=1);

require_once __DIR__ . '/db.php';

function jo_rows(string $sql, array $params = []): array
{
    $st = jo_db()->prepare($sql);
    $st->execute($params);
    return $st->fetchAll();
}

// bootstrap：マスタ＋工数。entries は staff ロールなら本人分のみ。
function jo_handle_bootstrap(array $user): array
{
    // マスタ（全ロール共通で参照可）
    $staff = array_map(static function ($r) {
        return [
            'code'      => (string) $r['code'],
            'name'      => (string) $r['name'],
            'sortOrder' => (int) $r['sortOrder'],
            'isActive'  => (int) $r['isActive'],
        ];
    }, jo_rows('SELECT code, name, sortOrder, isActive FROM jo_staff ORDER BY sortOrder, code'));

    $customers = array_map(static function ($r) {
        return [
            'code'          => (string) $r['code'],
            'name'          => (string) $r['name'],
            'paymentMethod' => $r['paymentMethod'],          // transfer/invoice/null
            'honorific'     => (string) $r['honorific'],
            'postalCode'    => $r['postalCode'],
            'address1'      => $r['address1'],
            'address2'      => $r['address2'],
            'contactName'   => $r['contactName'],
            'sortOrder'     => (int) $r['sortOrder'],
            'isActive'      => (int) $r['isActive'],
        ];
    }, jo_rows('SELECT code, name, paymentMethod, honorific, postalCode, address1, address2, contactName, sortOrder, isActive FROM jo_customers ORDER BY sortOrder, code'));

    $tasks = array_map(static function ($r) {
        return [
            'code'           => (string) $r['code'],
            'name'           => (string) $r['name'],
            'allocationType' => (string) $r['allocationType'],
            'sortOrder'      => (int) $r['sortOrder'],
        ];
    }, jo_rows('SELECT code, name, allocationType, sortOrder FROM jo_task_types ORDER BY sortOrder, code'));

    // taskTypes：業務区分名の配列（GAS は tasks.map(name).filter(Boolean)）
    $taskTypes = array_values(array_filter(array_map(static fn($t) => $t['name'], $tasks)));

    $taskPhases = array_map(static function ($r) {
        return [
            'taskCode'  => (string) $r['taskCode'],
            'phaseCode' => (string) $r['phaseCode'],
            'phaseName' => $r['phaseName'],
            'ratio'     => (float) $r['ratio'],
            'sortOrder' => (int) $r['sortOrder'],
        ];
    }, jo_rows('SELECT taskCode, phaseCode, phaseName, ratio, sortOrder FROM jo_task_phases ORDER BY taskCode, sortOrder'));

    $customerStaff = array_map(static function ($r) {
        return [
            'customerCode'  => (string) $r['customerCode'],
            'staffCode'     => (string) ($r['staffCode'] ?? ''),
            'role'          => (string) $r['role'],
            'effectiveFrom' => (string) ($r['effectiveFrom'] ?? ''),
            'sortOrder'     => (int) $r['sortOrder'],
        ];
    }, jo_rows('SELECT customerCode, staffCode, role, effectiveFrom, sortOrder FROM jo_customer_staff ORDER BY customerCode, role, effectiveFrom'));

    // settings：key→value のオブジェクト
    $settings = [];
    foreach (jo_rows('SELECT settingKey, settingValue FROM jo_app_settings') as $r) {
        $settings[(string) $r['settingKey']] = $r['settingValue'];
    }

    // entries：worklogs。氏名は JOIN で補完。staff ロールは本人分のみ。
    $where = '';
    $params = [];
    if (($user['role'] ?? '') === 'staff') {
        $where = ' WHERE w.staffCode = ?';
        $params[] = (string) ($user['staffCode'] ?? '');
    }
    $sql = 'SELECT w.id, w.`date`, w.staffCode, s.name AS staff, w.customerCode, c.name AS customer,'
         . ' w.taskType, w.taskCode, w.phaseCode, w.hours, w.memo, w.updatedAt'
         . ' FROM jo_worklogs w'
         . ' LEFT JOIN jo_staff s ON s.code = w.staffCode'
         . ' LEFT JOIN jo_customers c ON c.code = w.customerCode'
         . $where
         . ' ORDER BY w.`date`, w.id';
    $entries = array_map(static function ($r) {
        return [
            'id'           => (string) $r['id'],
            'date'         => (string) $r['date'],          // 'YYYY-MM-DD'
            'staffCode'    => (string) $r['staffCode'],
            'staff'        => (string) ($r['staff'] ?? ''),
            'customerCode' => (string) ($r['customerCode'] ?? ''),
            'customer'     => (string) ($r['customer'] ?? ''),
            'taskType'     => (string) ($r['taskType'] ?? ''),
            'taskCode'     => (string) ($r['taskCode'] ?? ''),
            'phaseCode'    => (string) ($r['phaseCode'] ?? ''),
            'hours'        => (float) $r['hours'],
            'memo'         => (string) ($r['memo'] ?? ''),
            'updatedAt'    => $r['updatedAt'],
        ];
    }, jo_rows($sql, $params));

    return [
        'staff'         => $staff,
        'customers'     => $customers,
        'tasks'         => $tasks,
        'taskTypes'     => $taskTypes,
        'taskPhases'    => $taskPhases,
        'customerStaff' => $customerStaff,
        'settings'      => $settings,
        'entries'       => $entries,
    ];
}

// dashboard：集計用フルデータ。bootstrap のコア＋billing＋targets。admin/manager 専用（呼び出し側で制御）。
function jo_handle_dashboard(array $user): array
{
    $core = jo_handle_bootstrap($user); // admin/manager のため entries は全件

    $billing = array_map(static function ($r) {
        return [
            'invoiceId'       => (string) $r['invoiceId'],
            'billingMonth'    => (string) $r['billingMonth'],
            'customerCode'    => (string) ($r['customerCode'] ?? ''),
            'customer'        => (string) ($r['customer'] ?? ''),
            'invoiceItem'     => (string) ($r['invoiceItem'] ?? ''),
            'invoiceItemCode' => (string) ($r['invoiceItemCode'] ?? ''),
            'paymentMethod'   => (string) ($r['paymentMethod'] ?? ''),
            'netAmount'       => (float) $r['netAmount'],
            'taxAmount'       => (float) $r['taxAmount'],
            'grossAmount'     => (float) $r['grossAmount'],
            'transferDate'    => (string) ($r['transferDate'] ?? ''),
            'issuedDate'      => (string) ($r['issuedDate'] ?? ''),
            'paymentDueDate'  => (string) ($r['paymentDueDate'] ?? ''),
            'paymentStatus'   => (string) ($r['paymentStatus'] ?? ''),
            'memo'            => (string) ($r['memo'] ?? ''),
        ];
    }, jo_rows('SELECT invoiceId, billingMonth, customerCode, customer, invoiceItem, invoiceItemCode, paymentMethod, netAmount, taxAmount, grossAmount, transferDate, issuedDate, paymentDueDate, paymentStatus, memo FROM jo_billings ORDER BY billingMonth, invoiceId'));

    $targets = array_map(static function ($r) {
        return [
            'targetMonth'  => (string) $r['targetMonth'],
            'staffCode'    => (string) $r['staffCode'],
            'staff'        => (string) ($r['staff'] ?? ''),
            'targetAmount' => (float) $r['targetAmount'],
        ];
    }, jo_rows('SELECT t.targetMonth, t.staffCode, s.name AS staff, t.targetAmount FROM jo_staff_targets t LEFT JOIN jo_staff s ON s.code = t.staffCode ORDER BY t.targetMonth, t.staffCode'));

    return array_merge($core, [
        'generatedAt' => date('c'),
        'billing'     => $billing,
        'targets'     => $targets,
    ]);
}

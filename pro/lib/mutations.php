<?php
// 更新系ハンドラ。GAS 版（Code.gs route_）の action・ペイロードを踏襲。
// 列名は既存JSONキー＝DBカラムに一致。氏名(staff/customer)は保存しない（参照時にJOIN）。
declare(strict_types=1);

require_once __DIR__ . '/db.php';

function jo_exec(string $sql, array $params = []): void
{
    jo_db()->prepare($sql)->execute($params);
}

// 許可キーのみ抽出
function jo_pick(array $src, array $allowed): array
{
    $out = [];
    foreach ($allowed as $k) {
        if (array_key_exists($k, $src)) {
            $out[$k] = $src[$k];
        }
    }
    return $out;
}

// '' を NULL に（NULL許容のDATE列などへ '' を入れると strict mode で落ちるため）
function jo_nullify(array &$cols, array $keys): void
{
    foreach ($keys as $k) {
        if (array_key_exists($k, $cols) && $cols[$k] === '') {
            $cols[$k] = null;
        }
    }
}

function jo_now(): string
{
    return date('Y-m-d H:i:s');
}

// INSERT ... ON DUPLICATE KEY UPDATE（PK/UNIQUE で upsert）
function jo_upsert(string $table, array $cols): void
{
    $names   = array_keys($cols);
    $place   = implode(', ', array_fill(0, count($names), '?'));
    $colList = implode(', ', array_map(static fn($c) => "`$c`", $names));
    $updates = implode(', ', array_map(static fn($c) => "`$c` = VALUES(`$c`)", $names));
    jo_exec("INSERT INTO `$table` ($colList) VALUES ($place) ON DUPLICATE KEY UPDATE $updates", array_values($cols));
}

// ---------------- 工数 ----------------
function jo_save_entry(array $entry): array
{
    if (empty($entry['id'])) {
        throw new InvalidArgumentException('entry.id required');
    }
    $cols = jo_pick($entry, ['id', 'date', 'staffCode', 'customerCode', 'taskCode', 'phaseCode', 'taskType', 'hours', 'memo']);
    if (isset($cols['hours'])) {
        $cols['hours'] = (float) $cols['hours'];
    }
    $cols['updatedAt'] = jo_now();
    jo_upsert('jo_worklogs', $cols);
    return ['id' => (string) $entry['id']];
}

function jo_delete_entry(string $id): void
{
    jo_exec('DELETE FROM jo_worklogs WHERE id = ?', [$id]);
}

// ---------------- 請求(billing) ----------------
function jo_save_billing(array $row): array
{
    if (empty($row['invoiceId'])) {
        throw new InvalidArgumentException('billing.invoiceId required');
    }
    $cols = jo_pick($row, [
        'invoiceId', 'billingMonth', 'customerCode', 'customer', 'invoiceItemCode', 'invoiceItem',
        'paymentMethod', 'source', 'netAmount', 'taxAmount', 'grossAmount',
        'issuedDate', 'paymentDueDate', 'paymentStatus', 'transferDate', 'memo',
    ]);
    foreach (['netAmount', 'taxAmount', 'grossAmount'] as $k) {
        if (array_key_exists($k, $cols)) {
            $cols[$k] = (float) $cols[$k];
        }
    }
    jo_nullify($cols, ['issuedDate', 'paymentDueDate', 'transferDate']);
    if (!isset($cols['source']) || $cols['source'] === '') {
        $cols['source'] = 'manual';
    }
    $cols['updatedAt'] = jo_now();
    jo_upsert('jo_billings', $cols);
    return ['invoiceId' => (string) $row['invoiceId']];
}

function jo_delete_billing(string $invoiceId): void
{
    jo_exec('DELETE FROM jo_billings WHERE invoiceId = ?', [$invoiceId]);
}

// ---------------- 売上目標 ----------------
function jo_save_target(array $row): array
{
    if (empty($row['targetMonth']) || empty($row['staffCode'])) {
        throw new InvalidArgumentException('target targetMonth/staffCode required');
    }
    $cols = jo_pick($row, ['targetMonth', 'staffCode', 'targetAmount']);
    if (isset($cols['targetAmount'])) {
        $cols['targetAmount'] = (float) $cols['targetAmount'];
    }
    $cols['updatedAt'] = jo_now();
    jo_upsert('jo_staff_targets', $cols);
    return ['targetMonth' => (string) $row['targetMonth'], 'staffCode' => (string) $row['staffCode']];
}

function jo_delete_target(string $month, string $staffCode): void
{
    jo_exec('DELETE FROM jo_staff_targets WHERE targetMonth = ? AND staffCode = ?', [$month, $staffCode]);
}

// ---------------- マスタ(staff/customers/tasks) ----------------
function jo_master_def(string $type): array
{
    switch ($type) {
        case 'staff':
            return ['table' => 'jo_staff', 'cols' => ['code', 'name', 'sortOrder', 'isActive']];
        case 'customers':
            return ['table' => 'jo_customers', 'cols' => ['code', 'name', 'paymentMethod', 'honorific', 'postalCode', 'address1', 'address2', 'contactName', 'sortOrder', 'isActive']];
        case 'tasks':
            return ['table' => 'jo_task_types', 'cols' => ['code', 'name', 'allocationType', 'sortOrder']];
        default:
            throw new InvalidArgumentException('unknown master type: ' . $type);
    }
}

function jo_upsert_master(string $type, array $item, string $oldCode = ''): array
{
    $def = jo_master_def($type);
    if (empty($item['code'])) {
        throw new InvalidArgumentException('item.code required');
    }
    $cols = jo_pick($item, $def['cols']);
    foreach (['sortOrder', 'isActive'] as $k) {
        if (array_key_exists($k, $cols)) {
            $cols[$k] = (int) $cols[$k];
        }
    }
    if (array_key_exists('paymentMethod', $cols) && $cols['paymentMethod'] === '') {
        $cols['paymentMethod'] = null; // ENUM へ '' は不可
    }
    $cols['updatedAt'] = jo_now();

    if ($oldCode !== '' && $oldCode !== (string) $item['code']) {
        // コード変更（リネーム）：oldCode の行を更新
        $sets = implode(', ', array_map(static fn($c) => "`$c` = ?", array_keys($cols)));
        jo_exec("UPDATE `{$def['table']}` SET $sets WHERE code = ?", array_merge(array_values($cols), [$oldCode]));
    } else {
        jo_upsert($def['table'], $cols);
    }
    return $item;
}

function jo_remove_master(string $type, string $code): void
{
    $def = jo_master_def($type);
    jo_exec("DELETE FROM `{$def['table']}` WHERE code = ?", [$code]);
}

// ---------------- 工程マスタ ----------------
function jo_save_task_phase(array $row): array
{
    if (empty($row['taskCode']) || empty($row['phaseCode'])) {
        throw new InvalidArgumentException('taskCode/phaseCode required');
    }
    $cols = jo_pick($row, ['taskCode', 'phaseCode', 'phaseName', 'ratio', 'sortOrder']);
    if (isset($cols['ratio'])) {
        $cols['ratio'] = (float) $cols['ratio'];
    }
    if (isset($cols['sortOrder'])) {
        $cols['sortOrder'] = (int) $cols['sortOrder'];
    }
    jo_upsert('jo_task_phases', $cols);
    return $row;
}

function jo_delete_task_phase(string $taskCode, string $phaseCode): void
{
    jo_exec('DELETE FROM jo_task_phases WHERE taskCode = ? AND phaseCode = ?', [$taskCode, $phaseCode]);
}

// ---------------- 顧客担当マスタ（時系列） ----------------
function jo_save_customer_staff(array $row): array
{
    if (empty($row['customerCode']) || empty($row['role'])) {
        throw new InvalidArgumentException('customerCode/role required');
    }
    $cols = jo_pick($row, ['customerCode', 'role', 'staffCode', 'effectiveFrom', 'sortOrder']);
    if (!array_key_exists('effectiveFrom', $cols) || $cols['effectiveFrom'] === null) {
        $cols['effectiveFrom'] = ''; // 空＝初期から（baseline）
    }
    if (array_key_exists('staffCode', $cols) && $cols['staffCode'] === null) {
        $cols['staffCode'] = ''; // 空＝担当解除(tombstone)
    }
    if (isset($cols['sortOrder'])) {
        $cols['sortOrder'] = (int) $cols['sortOrder'];
    }
    $cols['updatedAt'] = jo_now();
    jo_upsert('jo_customer_staff', $cols);
    return $row;
}

function jo_delete_customer_staff(string $customerCode, string $role, string $effectiveFrom): void
{
    jo_exec('DELETE FROM jo_customer_staff WHERE customerCode = ? AND role = ? AND effectiveFrom = ?', [$customerCode, $role, $effectiveFrom]);
}

// ---------------- 設定 ----------------
function jo_save_setting(string $key, $value): array
{
    jo_upsert('jo_app_settings', ['settingKey' => $key, 'settingValue' => $value, 'updatedAt' => jo_now()]);
    return ['key' => $key, 'value' => $value];
}

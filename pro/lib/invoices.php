<?php
// 請求書発行（JOfficeInvoice）。下書き→確定発行（採番・jo_billings射影）→取消。
// 設計正本: docs/invoice-feature-design.md。採番=YYYYMM-NNN（請求対象月・行ロック原子採番）。
declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mutations.php'; // jo_now / jo_exec 等

// ---- 設定（jo_app_settings） ----
function jo_app_settings(): array
{
    $out = [];
    foreach (jo_db()->query('SELECT settingKey, settingValue FROM jo_app_settings')->fetchAll() as $r) {
        $out[(string) $r['settingKey']] = $r['settingValue'];
    }
    return $out;
}

// ---- 支払期限の算出（dueRule） ----
function jo_invoice_due_date(?string $rule, string $issueDate, string $billingMonth): ?string
{
    $rule = $rule ?: 'net30';
    if ($issueDate === '') {
        return null;
    }
    if ($rule === 'net30') {
        return date('Y-m-d', strtotime($issueDate . ' +30 days'));
    }
    if ($rule === 'issueNextMonthEnd') {
        return date('Y-m-t', strtotime(date('Y-m-01', strtotime($issueDate)) . ' +1 month'));
    }
    if ($rule === 'billingNextMonthEnd') {
        $base = strtotime(($billingMonth ?: date('Y-m', strtotime($issueDate))) . '-01');
        return date('Y-m-t', strtotime(date('Y-m-01', $base) . ' +1 month'));
    }
    return date('Y-m-d', strtotime($issueDate . ' +30 days'));
}

// ---- 明細から税抜計・税・税込を算出（税率ごとに切り捨て＝確定） ----
function jo_invoice_totals(array $lines, string $roundMode = 'floor'): array
{
    $byRate = [];           // taxRate(%) => 税抜合計
    $subtotal = 0;
    foreach ($lines as $ln) {
        $amount = (int) round((float) ($ln['amount'] ?? 0));
        $rate = (float) ($ln['taxRate'] ?? 10.0);
        $subtotal += $amount;
        $byRate[(string) $rate] = ($byRate[(string) $rate] ?? 0) + $amount;
    }
    $tax = 0;
    foreach ($byRate as $rate => $sum) {
        $raw = $sum * ((float) $rate) / 100.0;
        $tax += ($roundMode === 'round') ? (int) round($raw) : (int) floor($raw);
    }
    return ['subtotal' => (int) $subtotal, 'tax' => (int) $tax, 'total' => (int) ($subtotal + $tax)];
}

// ---- 明細の正規化（amount 未指定は quantity×unitPrice） ----
function jo_invoice_norm_lines(array $rawLines): array
{
    $out = [];
    $no = 0;
    foreach ($rawLines as $ln) {
        $no += 1;
        $qty = (float) ($ln['quantity'] ?? 1);
        $unit = (float) ($ln['unitPrice'] ?? 0);
        $amount = array_key_exists('amount', $ln) && $ln['amount'] !== '' ? (int) round((float) $ln['amount']) : (int) round($qty * $unit);
        $out[] = [
            'lineNo'    => $no,
            'taskCode'  => trim((string) ($ln['taskCode'] ?? '')),
            'itemName'  => (string) ($ln['itemName'] ?? ''),
            'quantity'  => $qty,
            'unitPrice' => $unit,
            'amount'    => $amount,
            'taxRate'   => (float) ($ln['taxRate'] ?? 10.0),
            'sortOrder' => (int) ($ln['sortOrder'] ?? $no),
        ];
    }
    return $out;
}

// ---- 一覧 ----
function jo_list_invoices(array $f = []): array
{
    $where = [];
    $params = [];
    if (!empty($f['billingMonth'])) { $where[] = 'i.billingMonth = ?'; $params[] = (string) $f['billingMonth']; }
    if (!empty($f['customerCode'])) { $where[] = 'i.customerCode = ?'; $params[] = (string) $f['customerCode']; }
    if (!empty($f['status']))       { $where[] = 'i.status = ?';       $params[] = (string) $f['status']; }
    $sql = 'SELECT i.invoiceNo, i.customerCode, c.name AS customer, i.billingMonth, i.issueDate, i.dueDate,'
         . ' i.subtotal, i.tax, i.total, i.status, i.createdBy, u.displayName AS createdByName, i.createdAt, i.updatedAt'
         . ' FROM jo_invoices i LEFT JOIN jo_customers c ON c.code = i.customerCode'
         . ' LEFT JOIN jo_users u ON u.loginId = i.createdBy'
         . ($where ? (' WHERE ' . implode(' AND ', $where)) : '')
         . ' ORDER BY (i.status = "draft") DESC, i.billingMonth DESC, i.invoiceNo DESC';
    $st = jo_db()->prepare($sql);
    $st->execute($params);
    return array_map(static function ($r) {
        return [
            'invoiceNo'    => (string) $r['invoiceNo'],
            'customerCode' => (string) $r['customerCode'],
            'customer'     => (string) ($r['customer'] ?? ''),
            'billingMonth' => (string) $r['billingMonth'],
            'issueDate'    => $r['issueDate'],
            'dueDate'      => $r['dueDate'],
            'subtotal'     => (int) $r['subtotal'],
            'tax'          => (int) $r['tax'],
            'total'        => (int) $r['total'],
            'status'       => (string) $r['status'],
            'isDraft'      => $r['status'] === 'draft' ? 1 : 0,
            'createdBy'    => (string) ($r['createdBy'] ?? ''),
            'createdByName'=> (string) ($r['createdByName'] ?? ''),
            'updatedAt'    => $r['updatedAt'],
        ];
    }, $st->fetchAll());
}

// ---- 取得（ヘッダ＋明細） ----
function jo_get_invoice(string $invoiceNo): ?array
{
    $st = jo_db()->prepare('SELECT i.*, u.displayName AS createdByName FROM jo_invoices i LEFT JOIN jo_users u ON u.loginId = i.createdBy WHERE i.invoiceNo = ?');
    $st->execute([$invoiceNo]);
    $h = $st->fetch();
    if (!$h) {
        return null;
    }
    $ls = jo_db()->prepare('SELECT * FROM jo_invoice_lines WHERE invoiceNo = ? ORDER BY sortOrder, lineNo');
    $ls->execute([$invoiceNo]);
    $lines = array_map(static function ($r) {
        return [
            'lineNo'    => (int) $r['lineNo'],
            'taskCode'  => (string) ($r['taskCode'] ?? ''),
            'itemName'  => (string) $r['itemName'],
            'quantity'  => (float) $r['quantity'],
            'unitPrice' => (float) $r['unitPrice'],
            'amount'    => (int) $r['amount'],
            'taxRate'   => (float) $r['taxRate'],
            'sortOrder' => (int) $r['sortOrder'],
        ];
    }, $ls->fetchAll());
    return ['header' => $h, 'lines' => $lines];
}

// ---- 明細の差し替え保存 ----
function jo_invoice_replace_lines(PDO $db, string $invoiceNo, array $lines): void
{
    $db->prepare('DELETE FROM jo_invoice_lines WHERE invoiceNo = ?')->execute([$invoiceNo]);
    $ins = $db->prepare('INSERT INTO jo_invoice_lines (invoiceNo, lineNo, taskCode, itemName, quantity, unitPrice, amount, taxRate, sortOrder) VALUES (?,?,?,?,?,?,?,?,?)');
    foreach ($lines as $ln) {
        $ins->execute([$invoiceNo, $ln['lineNo'], $ln['taskCode'] !== '' ? $ln['taskCode'] : null, $ln['itemName'], $ln['quantity'], $ln['unitPrice'], $ln['amount'], $ln['taxRate'], $ln['sortOrder']]);
    }
}

// ---- 下書き保存（採番・射影なし）。新規は draft_xxxx を採番、既存は更新。 ----
function jo_save_invoice_draft(array $in, array $user): array
{
    $db = jo_db();
    $no = trim((string) ($in['invoiceNo'] ?? ''));
    $isNew = ($no === '');
    if ($isNew) {
        $no = 'draft_' . uniqid();
    }
    // 既存が issued/void なら下書き保存不可
    if (!$isNew) {
        $cur = $db->prepare('SELECT status FROM jo_invoices WHERE invoiceNo = ?');
        $cur->execute([$no]);
        $row = $cur->fetch();
        if ($row && $row['status'] !== 'draft') {
            throw new InvalidArgumentException('not_editable');
        }
    }
    $customerCode = trim((string) ($in['customerCode'] ?? ''));
    if ($customerCode === '') {
        throw new InvalidArgumentException('customer_required');
    }
    $billingMonth = (string) ($in['billingMonth'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}$/', $billingMonth)) {
        throw new InvalidArgumentException('billingMonth_required');
    }
    $issueDate = (string) ($in['issueDate'] ?? '') ?: date('Y-m-d');
    $dueRule = (string) ($in['dueRule'] ?? '') ?: ((string) (jo_app_settings()['invoice.dueRuleDefault'] ?? 'net30'));
    $dueDate = (string) ($in['dueDate'] ?? '') ?: (jo_invoice_due_date($dueRule, $issueDate, $billingMonth) ?? '');
    $lines = jo_invoice_norm_lines($in['lines'] ?? []);
    $totals = jo_invoice_totals($lines, (string) (jo_app_settings()['invoice.taxRoundMode'] ?? 'floor'));
    $now = jo_now();

    $cols = [
        'invoiceNo'       => $no,
        'customerCode'    => $customerCode,
        'billingMonth'    => $billingMonth,
        'issueDate'       => $issueDate,
        'dueDate'         => $dueDate !== '' ? $dueDate : null,
        'dueRule'         => $dueRule,
        'billToName'      => (string) ($in['billToName'] ?? ''),
        'billToHonorific' => (string) ($in['billToHonorific'] ?? '御中'),
        'billToAddress'   => (string) ($in['billToAddress'] ?? ''),
        'subject'         => (string) ($in['subject'] ?? ''),
        'subtotal'        => $totals['subtotal'],
        'tax'             => $totals['tax'],
        'total'           => $totals['total'],
        'status'          => 'draft',
        'memo'            => (string) ($in['memo'] ?? ''),
        'remarks'         => (string) ($in['remarks'] ?? ''),
        'updatedAt'       => $now,
    ];
    if ($isNew) {
        $cols['createdBy'] = (string) ($user['loginId'] ?? '');
        $cols['createdAt'] = $now;
    }
    $db->beginTransaction();
    try {
        jo_upsert('jo_invoices', $cols);
        jo_invoice_replace_lines($db, $no, $lines);
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }
    return ['invoiceNo' => $no, 'status' => 'draft', 'subtotal' => $totals['subtotal'], 'tax' => $totals['tax'], 'total' => $totals['total']];
}

// ---- 確定発行（採番＋射影・原子的） ----
function jo_issue_invoice(string $no, array $user): array
{
    $db = jo_db();
    $settings = jo_app_settings();
    $db->beginTransaction();
    try {
        $st = $db->prepare('SELECT * FROM jo_invoices WHERE invoiceNo = ? FOR UPDATE');
        $st->execute([$no]);
        $inv = $st->fetch();
        if (!$inv) {
            throw new InvalidArgumentException('invoice_not_found');
        }
        if ($inv['status'] !== 'draft') {
            throw new InvalidArgumentException('already_issued');
        }
        $ls = $db->prepare('SELECT * FROM jo_invoice_lines WHERE invoiceNo = ? ORDER BY sortOrder, lineNo');
        $ls->execute([$no]);
        $lines = $ls->fetchAll();
        if (!$lines) {
            throw new InvalidArgumentException('no_lines');
        }

        // 採番（請求対象月・行ロック）
        $period = str_replace('-', '', (string) $inv['billingMonth']); // YYYYMM
        $db->prepare('INSERT IGNORE INTO jo_invoice_seq (periodKey, lastSeq) VALUES (?, 0)')->execute([$period]);
        $sq = $db->prepare('SELECT lastSeq FROM jo_invoice_seq WHERE periodKey = ? FOR UPDATE');
        $sq->execute([$period]);
        $seq = (int) $sq->fetchColumn() + 1;
        $db->prepare('UPDATE jo_invoice_seq SET lastSeq = ? WHERE periodKey = ?')->execute([$seq, $period]);
        $invoiceNo = $period . '-' . str_pad((string) $seq, 3, '0', STR_PAD_LEFT);

        $now = jo_now();
        $issuerRegNo = (string) ($settings['issuer.regNo'] ?? '');
        // ヘッダを実番号でINSERT（status=issued・登録番号スナップショット）
        $db->prepare('INSERT INTO jo_invoices (invoiceNo, customerCode, billingMonth, issueDate, dueDate, dueRule, billToName, billToHonorific, billToAddress, subject, subtotal, tax, total, issuerRegNo, status, memo, remarks, createdBy, createdAt, updatedAt)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
           ->execute([
               $invoiceNo, $inv['customerCode'], $inv['billingMonth'], $inv['issueDate'], $inv['dueDate'], $inv['dueRule'],
               $inv['billToName'], $inv['billToHonorific'], $inv['billToAddress'], ($inv['subject'] ?? ''),
               $inv['subtotal'], $inv['tax'], $inv['total'], $issuerRegNo, 'issued', $inv['memo'], ($inv['remarks'] ?? ''),
               (string) ($user['loginId'] ?? ''), $now, $now,
           ]);
        // 明細を実番号へコピー
        $ins = $db->prepare('INSERT INTO jo_invoice_lines (invoiceNo, lineNo, taskCode, itemName, quantity, unitPrice, amount, taxRate, sortOrder) VALUES (?,?,?,?,?,?,?,?,?)');
        foreach ($lines as $ln) {
            $ins->execute([$invoiceNo, $ln['lineNo'], $ln['taskCode'], $ln['itemName'], $ln['quantity'], $ln['unitPrice'], $ln['amount'], $ln['taxRate'], $ln['sortOrder']]);
        }
        // jo_billings 射影
        jo_project_invoice($db, $invoiceNo, $inv, $lines);
        // 下書き行を削除（明細はCASCADE）
        $db->prepare('DELETE FROM jo_invoices WHERE invoiceNo = ?')->execute([$no]);

        $db->commit();
        return ['invoiceNo' => $invoiceNo, 'status' => 'issued'];
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }
}

// ---- jo_billings 射影（§7・決定論ID・業務コードごと＋税080一本） ----
function jo_project_invoice(PDO $db, string $invoiceNo, array $inv, array $lines): void
{
    $custName = '';
    $cn = $db->prepare('SELECT name FROM jo_customers WHERE code = ?');
    $cn->execute([$inv['customerCode']]);
    $custName = (string) ($cn->fetchColumn() ?: ($inv['billToName'] ?? ''));

    // 業務コードごとに税抜を集約
    $byCode = [];
    foreach ($lines as $ln) {
        $code = (string) ($ln['taskCode'] ?? '');
        $key = $code !== '' ? $code : ('L' . $ln['lineNo']);
        if (!isset($byCode[$key])) {
            $byCode[$key] = ['code' => $code, 'name' => (string) $ln['itemName'], 'net' => 0];
        }
        $byCode[$key]['net'] += (int) $ln['amount'];
    }
    $ins = $db->prepare('INSERT INTO jo_billings (invoiceId, billingMonth, customerCode, customer, invoiceItemCode, invoiceItem, paymentMethod, source, netAmount, taxAmount, grossAmount, issuedDate, paymentDueDate, transferDate, updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)
        ON DUPLICATE KEY UPDATE billingMonth=VALUES(billingMonth), customerCode=VALUES(customerCode), customer=VALUES(customer), invoiceItemCode=VALUES(invoiceItemCode), invoiceItem=VALUES(invoiceItem), paymentMethod=VALUES(paymentMethod), source=VALUES(source), netAmount=VALUES(netAmount), taxAmount=VALUES(taxAmount), grossAmount=VALUES(grossAmount), issuedDate=VALUES(issuedDate), paymentDueDate=VALUES(paymentDueDate), transferDate=NULL, updatedAt=VALUES(updatedAt)');
    $now = jo_now();
    foreach ($byCode as $key => $row) {
        $invoiceId = 'inv_' . $invoiceNo . '_' . ($row['code'] !== '' ? $row['code'] : $key);
        $ins->execute([
            $invoiceId, $inv['billingMonth'], $inv['customerCode'], $custName,
            $row['code'], $row['name'], '請求書払い', 'invoice',
            (int) $row['net'], 0, (int) $row['net'], $inv['issueDate'], $inv['dueDate'], $now,
        ]);
    }
    // 消費税 080 一本（netAmount=税額・taxAmount=0）
    $tax = (int) $inv['tax'];
    if ($tax > 0) {
        $ins->execute([
            'inv_' . $invoiceNo . '_080', $inv['billingMonth'], $inv['customerCode'], $custName,
            '080', '消費税', '請求書払い', 'invoice',
            $tax, 0, $tax, $inv['issueDate'], $inv['dueDate'], $now,
        ]);
    }
}

// ---- 取消（射影削除＋void保持・物理削除しない） ----
function jo_void_invoice(string $invoiceNo, array $user): array
{
    $db = jo_db();
    $db->beginTransaction();
    try {
        $st = $db->prepare('SELECT status FROM jo_invoices WHERE invoiceNo = ? FOR UPDATE');
        $st->execute([$invoiceNo]);
        $row = $st->fetch();
        if (!$row) {
            throw new InvalidArgumentException('invoice_not_found');
        }
        if ($row['status'] === 'draft') {
            throw new InvalidArgumentException('cannot_void_draft');
        }
        if ($row['status'] === 'void') {
            throw new InvalidArgumentException('already_void');
        }
        // 射影削除（同 invoiceNo 接頭辞）
        $db->prepare("DELETE FROM jo_billings WHERE invoiceId LIKE ?")->execute(['inv_' . $invoiceNo . '_%']);
        $db->prepare('UPDATE jo_invoices SET status = "void", updatedAt = ? WHERE invoiceNo = ?')->execute([jo_now(), $invoiceNo]);
        $db->commit();
        return ['invoiceNo' => $invoiceNo, 'status' => 'void'];
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }
}

// ---- 複製（任意の請求書→新規下書き・前月複製にも使用） ----
function jo_duplicate_invoice(string $srcNo, array $in, array $user): array
{
    $src = jo_get_invoice($srcNo);
    if (!$src) {
        throw new InvalidArgumentException('invoice_not_found');
    }
    $h = $src['header'];
    $draft = [
        'customerCode'    => $h['customerCode'],
        'billingMonth'    => (string) ($in['billingMonth'] ?? $h['billingMonth']),
        'issueDate'       => (string) ($in['issueDate'] ?? date('Y-m-d')),
        'dueRule'         => $h['dueRule'],
        'billToName'      => $h['billToName'],
        'billToHonorific' => $h['billToHonorific'],
        'billToAddress'   => $h['billToAddress'],
        'subject'         => $h['subject'] ?? '',
        'memo'            => $h['memo'],
        'remarks'         => $h['remarks'] ?? '',
        'lines'           => array_map(static function ($l) {
            return ['taskCode' => $l['taskCode'], 'itemName' => $l['itemName'], 'quantity' => $l['quantity'], 'unitPrice' => $l['unitPrice'], 'amount' => $l['amount'], 'taxRate' => $l['taxRate'], 'sortOrder' => $l['sortOrder']];
        }, $src['lines']),
    ];
    return jo_save_invoice_draft($draft, $user);
}

// ---- 下書き削除（issued/voidは不可） ----
function jo_delete_invoice_draft(string $invoiceNo): void
{
    $db = jo_db();
    $st = $db->prepare('SELECT status FROM jo_invoices WHERE invoiceNo = ?');
    $st->execute([$invoiceNo]);
    $row = $st->fetch();
    if (!$row) {
        return;
    }
    if ($row['status'] !== 'draft') {
        throw new InvalidArgumentException('cannot_delete_issued');
    }
    $db->prepare('DELETE FROM jo_invoices WHERE invoiceNo = ?')->execute([$invoiceNo]); // 明細CASCADE
}

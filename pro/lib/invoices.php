<?php
// 請求書発行（JOfficeInvoice）。下書き→確定発行（採番・jo_billings射影）→取消。
// 設計正本: docs/invoice-feature-design.md。採番=YYYYMM-NNN（請求対象月・行ロック原子採番）。
declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/mutations.php'; // jo_now / jo_exec 等
require_once __DIR__ . '/mailer.php';    // メール送付（§14・ダミードライバ）

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
         . ' i.subtotal, i.tax, i.total, i.status, i.paidDate, i.paidBy, pu.displayName AS paidByName,'
         . ' i.sentDate, i.sentBy, i.sentCount, i.sentMethod, su.displayName AS sentByName,'
         . ' i.createdBy, u.displayName AS createdByName, i.createdAt, i.updatedAt'
         . ' FROM jo_invoices i LEFT JOIN jo_customers c ON c.code = i.customerCode'
         . ' LEFT JOIN jo_users u ON u.loginId = i.createdBy'
         . ' LEFT JOIN jo_users pu ON pu.loginId = i.paidBy'
         . ' LEFT JOIN jo_users su ON su.loginId = i.sentBy'
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
            'paidDate'     => $r['paidDate'],
            'paidBy'       => (string) ($r['paidBy'] ?? ''),
            'paidByName'   => (string) ($r['paidByName'] ?? ''),
            'sentDate'     => $r['sentDate'],
            'sentBy'       => (string) ($r['sentBy'] ?? ''),
            'sentByName'   => (string) ($r['sentByName'] ?? ''),
            'sentCount'    => (int) ($r['sentCount'] ?? 0),
            'sentMethod'   => (string) ($r['sentMethod'] ?? ''),
            'createdBy'    => (string) ($r['createdBy'] ?? ''),
            'createdByName'=> (string) ($r['createdByName'] ?? ''),
            'updatedAt'    => $r['updatedAt'],
        ];
    }, $st->fetchAll());
}

/** 入金消込：発行済み請求書に入金日を記録（手動）。status とは独立。 */
function jo_mark_invoice_paid(string $invoiceNo, array $user, string $paidDate = ''): array
{
    $db = jo_db();
    $st = $db->prepare('SELECT status FROM jo_invoices WHERE invoiceNo = ?');
    $st->execute([$invoiceNo]);
    $row = $st->fetch();
    if (!$row) {
        throw new InvalidArgumentException('invoice_not_found');
    }
    if ($row['status'] !== 'issued') {
        throw new InvalidArgumentException('not_issued'); // 下書き/取消は消込不可
    }
    $pd = (preg_match('/^\d{4}-\d{2}-\d{2}$/', $paidDate)) ? $paidDate : substr(jo_now(), 0, 10);
    $db->prepare('UPDATE jo_invoices SET paidDate = ?, paidBy = ?, updatedAt = ? WHERE invoiceNo = ?')
       ->execute([$pd, (string) ($user['loginId'] ?? ''), jo_now(), $invoiceNo]);
    return ['invoiceNo' => $invoiceNo, 'paidDate' => $pd];
}

/** 入金取消：入金記録をクリア（未入金へ戻す）。 */
function jo_unmark_invoice_paid(string $invoiceNo): array
{
    $db = jo_db();
    $st = $db->prepare('SELECT status FROM jo_invoices WHERE invoiceNo = ?');
    $st->execute([$invoiceNo]);
    if (!$st->fetch()) {
        throw new InvalidArgumentException('invoice_not_found');
    }
    $db->prepare('UPDATE jo_invoices SET paidDate = NULL, paidBy = NULL, updatedAt = ? WHERE invoiceNo = ?')
       ->execute([jo_now(), $invoiceNo]);
    return ['invoiceNo' => $invoiceNo, 'paidDate' => null];
}

// ---- 取得（ヘッダ＋明細） ----
function jo_get_invoice(string $invoiceNo): ?array
{
    $st = jo_db()->prepare('SELECT i.*, u.displayName AS createdByName, pu.displayName AS paidByName FROM jo_invoices i LEFT JOIN jo_users u ON u.loginId = i.createdBy LEFT JOIN jo_users pu ON pu.loginId = i.paidBy WHERE i.invoiceNo = ?');
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
        $verifyToken = bin2hex(random_bytes(16)); // 128bit・真正性検証(QR)用の照合鍵
        // ヘッダを実番号でINSERT（status=issued・登録番号スナップショット・検証トークン）
        $db->prepare('INSERT INTO jo_invoices (invoiceNo, customerCode, billingMonth, issueDate, dueDate, dueRule, billToName, billToHonorific, billToAddress, subject, subtotal, tax, total, issuerRegNo, status, memo, remarks, verifyToken, createdBy, createdAt, updatedAt)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
           ->execute([
               $invoiceNo, $inv['customerCode'], $inv['billingMonth'], $inv['issueDate'], $inv['dueDate'], $inv['dueRule'],
               $inv['billToName'], $inv['billToHonorific'], $inv['billToAddress'], ($inv['subject'] ?? ''),
               $inv['subtotal'], $inv['tax'], $inv['total'], $issuerRegNo, 'issued', $inv['memo'], ($inv['remarks'] ?? ''),
               $verifyToken, (string) ($user['loginId'] ?? ''), $now, $now,
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
        $st = $db->prepare('SELECT status, paidDate FROM jo_invoices WHERE invoiceNo = ? FOR UPDATE');
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
        if (!empty($row['paidDate'])) {
            // 入金済みのまま void すると「void なのに入金済」の不整合になる。先に入金取消が必要。
            throw new InvalidArgumentException('paid_cannot_void');
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

// ---- ダッシュボード集計（請求書払い運用の実務指標・1リクエストで返却） ----
// 発行済＝status が draft/void 以外（現行は issued のみ。将来 sent/paid が入っても集計対象）。
// 未入金は status='issued' かつ paidDate IS NULL で判定（入金は paidDate 独立管理のため）。
function jo_invoice_dashboard(array $opts = []): array
{
    $db = jo_db();
    $today     = date('Y-m-d');
    $thisMonth = date('Y-m');

    // 対象月（既定＝前月）。'YYYY-MM'。請求漏れ・対象月KPIの基準。
    $tm = (string) ($opts['month'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}$/', $tm)) {
        $tm = date('Y-m', strtotime('-1 month', strtotime(date('Y-m-01'))));
    }
    $prevM = date('Y-m', strtotime('-1 month', strtotime($tm . '-01')));

    // --- KPI: 売掛（未入金残高）全体 ---
    $ar = $db->query("SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM jo_invoices WHERE status='issued' AND paidDate IS NULL")->fetch();
    // --- KPI: 延滞（期限超過・未入金）全体 ---
    $ov = $db->prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM jo_invoices WHERE status='issued' AND paidDate IS NULL AND dueDate IS NOT NULL AND dueDate < ?");
    $ov->execute([$today]);
    $ovr = $ov->fetch();
    // --- KPI: 対象月の請求（発行済） ---
    $bm = $db->prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM jo_invoices WHERE billingMonth=? AND status NOT IN ('draft','void')");
    $bm->execute([$tm]);
    $bmr = $bm->fetch();
    // --- KPI: 対象月の入金（回収済） ---
    $cm = $db->prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM jo_invoices WHERE billingMonth=? AND status NOT IN ('draft','void') AND paidDate IS NOT NULL");
    $cm->execute([$tm]);
    $cmr = $cm->fetch();
    // --- KPI: 未送付（発行済・未送付＝メール/郵送のいずれも未実施）全体 ---
    $un = $db->query("SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM jo_invoices WHERE status='issued' AND sentDate IS NULL")->fetch();

    // --- ステータス内訳（全体） ---
    $sb = $db->query("SELECT
        SUM(status='draft') d,
        SUM(status='issued' AND paidDate IS NULL) u,
        SUM(status='issued' AND paidDate IS NOT NULL) p,
        SUM(status='void') v
      FROM jo_invoices")->fetch();

    // --- 請求漏れ（請求書払いの有効顧客で対象月に請求書が無い先） ---
    $elig = $db->query("SELECT code, name FROM jo_customers WHERE paymentMethod='invoice' AND isActive=1 ORDER BY sortOrder, code")->fetchAll();
    $billed = [];
    $bq = $db->prepare("SELECT DISTINCT customerCode FROM jo_invoices WHERE billingMonth=? AND status NOT IN ('draft','void')");
    $bq->execute([$tm]);
    foreach ($bq->fetchAll() as $r) {
        $billed[(string) $r['customerCode']] = true;
    }
    // 前月の請求額（顧客別・参考表示用）
    $prevMap = [];
    $pq = $db->prepare("SELECT customerCode, COALESCE(SUM(total),0) s FROM jo_invoices WHERE billingMonth=? AND status NOT IN ('draft','void') GROUP BY customerCode");
    $pq->execute([$prevM]);
    foreach ($pq->fetchAll() as $r) {
        $prevMap[(string) $r['customerCode']] = (int) $r['s'];
    }
    $missing = [];
    foreach ($elig as $c) {
        $code = (string) $c['code'];
        if (!isset($billed[$code])) {
            $missing[] = ['code' => $code, 'name' => (string) $c['name'], 'prevTotal' => (int) ($prevMap[$code] ?? 0)];
        }
    }

    // --- 月次トレンド（直近12ヶ月・請求対象月ベース・当月まで） ---
    $months = [];
    for ($i = 11; $i >= 0; $i--) {
        $months[] = date('Y-m', strtotime("-$i month", strtotime($thisMonth . '-01')));
    }
    $trendMap = [];
    $tq = $db->prepare("SELECT billingMonth, COUNT(*) c, COALESCE(SUM(total),0) s FROM jo_invoices WHERE status NOT IN ('draft','void') AND billingMonth BETWEEN ? AND ? GROUP BY billingMonth");
    $tq->execute([$months[0], $months[11]]);
    foreach ($tq->fetchAll() as $r) {
        $trendMap[(string) $r['billingMonth']] = ['count' => (int) $r['c'], 'total' => (int) $r['s']];
    }
    $trend = array_map(static function ($m) use ($trendMap) {
        return ['month' => $m, 'count' => (int) ($trendMap[$m]['count'] ?? 0), 'total' => (int) ($trendMap[$m]['total'] ?? 0)];
    }, $months);

    return [
        'targetMonth' => $tm,
        'prevMonth'   => $prevM,
        'today'       => $today,
        'ar'        => ['count' => (int) $ar['c'],  'total' => (int) $ar['s']],
        'overdue'   => ['count' => (int) $ovr['c'], 'total' => (int) $ovr['s']],
        'billed'    => ['count' => (int) $bmr['c'], 'total' => (int) $bmr['s']],
        'collected' => ['count' => (int) $cmr['c'], 'total' => (int) $cmr['s']],
        'unsent'    => ['count' => (int) $un['c'],  'total' => (int) $un['s']],
        'status'    => [
            'draft'        => (int) $sb['d'],
            'issuedUnpaid' => (int) $sb['u'],
            'paid'         => (int) $sb['p'],
            'void'         => (int) $sb['v'],
        ],
        'missing' => ['eligible' => count($elig), 'count' => count($missing), 'list' => $missing],
        'trend'   => $trend,
    ];
}

// =====================================================================
// メール送付（§14）。実送信はダミードライバ（lib/mailer.php）。単票送信・admin。
// 送信状態は sentDate/sentBy/sentCount（status とは独立）。履歴は jo_invoice_mails。
// =====================================================================

// 送信モーダル用の下書き（宛先＝顧客マスタ email/ccEmail、件名/本文＝テンプレ展開）。
function jo_get_invoice_mail_draft(string $invoiceNo): array
{
    $inv = jo_get_invoice($invoiceNo);
    if ($inv === null) {
        throw new InvalidArgumentException('invoice_not_found');
    }
    $h = $inv['header'];
    $settings = jo_app_settings();
    $mset = jo_mail_settings($settings);

    $to = '';
    $cc = '';
    $cst = jo_db()->prepare('SELECT email, ccEmail FROM jo_customers WHERE code = ?');
    $cst->execute([(string) $h['customerCode']]);
    if ($c = $cst->fetch()) {
        $to = (string) ($c['email'] ?? '');
        $cc = (string) ($c['ccEmail'] ?? '');
    }
    $vars = jo_mail_build_vars($h, $settings);
    return [
        'invoiceNo'    => $invoiceNo,
        'customerCode' => (string) $h['customerCode'],
        'to'           => $to,
        'cc'           => $cc,
        'subject'      => jo_mail_render_template($mset['mail.subjectTemplate'], $vars),
        'body'         => jo_mail_render_template($mset['mail.bodyTemplate'], $vars),
        'pdfName'      => 'invoice-' . preg_replace('/[^A-Za-z0-9_\-]/', '_', $invoiceNo) . '.pdf',
        'driver'       => $mset['mail.driver'],
        'status'       => (string) $h['status'],
        'canSend'      => ($h['status'] === 'issued'),
        'sentDate'     => $h['sentDate'] ?? null,
        'sentCount'    => (int) ($h['sentCount'] ?? 0),
    ];
}

// 送信実行。発行済のみ。PDF はダミーでも実生成しパイプライン検証。履歴を必ず記録。
function jo_send_invoice_mail(string $invoiceNo, array $in, array $user): array
{
    $inv = jo_get_invoice($invoiceNo);
    if ($inv === null) {
        throw new InvalidArgumentException('invoice_not_found');
    }
    $h = $inv['header'];
    if ($h['status'] !== 'issued') {
        throw new InvalidArgumentException('not_sendable'); // 下書き/取消は送信不可
    }
    $isTest  = !empty($in['isTest']);
    $subject = trim((string) ($in['subject'] ?? ''));
    $body    = (string) ($in['body'] ?? '');
    $toList  = jo_mail_parse_addrs((string) ($in['to'] ?? ''));
    $ccList  = jo_mail_parse_addrs((string) ($in['cc'] ?? ''));
    if (!$toList) {
        throw new InvalidArgumentException('to_required');
    }
    foreach (array_merge($toList, $ccList) as $a) {
        if (!filter_var($a, FILTER_VALIDATE_EMAIL)) {
            throw new InvalidArgumentException('invalid_email:' . $a);
        }
    }
    if ($subject === '') {
        throw new InvalidArgumentException('subject_required');
    }

    $settings = jo_app_settings();
    $mset = jo_mail_settings($settings);

    // PDF 生成（ダミーでも実生成して整合性検証・将来の実送信を前倒しで担保）。
    require_once __DIR__ . '/invoice_pdf.php';
    $pdf = jo_render_invoice_pdf($h, $inv['lines'], $settings, ['dest' => 'S']);
    $pdfName = 'invoice-' . preg_replace('/[^A-Za-z0-9_\-]/', '_', $invoiceNo) . '.pdf';

    $res = jo_mail_send([
        'to'          => $toList,
        'cc'          => $ccList,
        'subject'     => $subject,
        'body'        => $body,
        'fromName'    => $mset['mail.fromName'],
        'fromAddress' => $mset['mail.fromAddress'],
        'replyTo'     => $mset['mail.replyTo'],
        'pdf'         => $pdf,
        'pdfName'     => $pdfName,
    ], $mset['mail.driver']);

    $now = jo_now();
    $result = $isTest ? 'test' : ($res['ok'] ? 'sent' : 'failed');
    // 履歴は成否によらず記録（監査・失敗の可視化）。method=email。
    jo_db()->prepare('INSERT INTO jo_invoice_mails (invoiceNo, toAddr, ccAddr, subject, body, pdfName, driver, result, isTest, errorText, sentBy, createdAt, method) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        ->execute([
            $invoiceNo, implode(', ', $toList), implode(', ', $ccList), $subject, $body, $pdfName,
            $res['driver'], $result, $isTest ? 1 : 0, ($res['error'] !== '' ? $res['error'] : null),
            (string) ($user['loginId'] ?? ''), $now, 'email',
        ]);
    // 本送信かつ成功のときのみ送付状態を更新（テストは更新しない）。sentMethod=email。
    if ($res['ok'] && !$isTest) {
        jo_db()->prepare('UPDATE jo_invoices SET sentDate = ?, sentBy = ?, sentMethod = ?, sentCount = sentCount + 1, updatedAt = ? WHERE invoiceNo = ?')
            ->execute([substr($now, 0, 10), (string) ($user['loginId'] ?? ''), 'email', $now, $invoiceNo]);
    }
    if (!$res['ok']) {
        // 失敗（現行ドライバでは発生しない。SMTP 実装後の保険）。履歴は残しつつ 400 で理由返却。
        throw new InvalidArgumentException('send_failed:' . ($res['error'] !== '' ? $res['error'] : 'unknown'));
    }
    return [
        'invoiceNo' => $invoiceNo,
        'result'    => $result,
        'driver'    => $res['driver'],
        'messageId' => $res['messageId'],
        'isTest'    => $isTest ? 1 : 0,
        'pdfBytes'  => strlen($pdf),
    ];
}

// 郵送済みにする（手動記録）。PDFを印刷・郵送したケースを送付済として記録。
// メール送信と同じく sentDate/sentBy/sentCount を更新し、送付履歴に method=post で1行残す。
function jo_mark_invoice_posted(string $invoiceNo, array $user, string $postDate = ''): array
{
    $db = jo_db();
    $st = $db->prepare('SELECT status FROM jo_invoices WHERE invoiceNo = ?');
    $st->execute([$invoiceNo]);
    $row = $st->fetch();
    if (!$row) {
        throw new InvalidArgumentException('invoice_not_found');
    }
    if ($row['status'] !== 'issued') {
        throw new InvalidArgumentException('not_sendable'); // 下書き/取消は送付記録不可
    }
    $pd = preg_match('/^\d{4}-\d{2}-\d{2}$/', $postDate) ? $postDate : substr(jo_now(), 0, 10);
    $now = jo_now();
    $db->prepare('INSERT INTO jo_invoice_mails (invoiceNo, toAddr, ccAddr, subject, body, pdfName, driver, result, isTest, errorText, sentBy, createdAt, method) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        ->execute([$invoiceNo, '', '', '郵送', '', '', 'post', 'sent', 0, null, (string) ($user['loginId'] ?? ''), $now, 'post']);
    $db->prepare('UPDATE jo_invoices SET sentDate = ?, sentBy = ?, sentMethod = ?, sentCount = sentCount + 1, updatedAt = ? WHERE invoiceNo = ?')
        ->execute([$pd, (string) ($user['loginId'] ?? ''), 'post', $now, $invoiceNo]);
    return ['invoiceNo' => $invoiceNo, 'sentDate' => $pd, 'sentMethod' => 'post'];
}

// 送付取消（送付状態のクリア）。誤って送付済にした場合に未送付へ戻す。履歴は監査のため残す。
function jo_unmark_invoice_sent(string $invoiceNo): array
{
    $db = jo_db();
    $st = $db->prepare('SELECT status FROM jo_invoices WHERE invoiceNo = ?');
    $st->execute([$invoiceNo]);
    if (!$st->fetch()) {
        throw new InvalidArgumentException('invoice_not_found');
    }
    $db->prepare('UPDATE jo_invoices SET sentDate = NULL, sentBy = NULL, sentMethod = NULL, sentCount = 0, updatedAt = ? WHERE invoiceNo = ?')
        ->execute([jo_now(), $invoiceNo]);
    return ['invoiceNo' => $invoiceNo];
}

// 送付履歴（新しい順・メール/郵送を一元表示）。
function jo_list_invoice_mails(string $invoiceNo): array
{
    $st = jo_db()->prepare('SELECT m.*, u.displayName AS sentByName FROM jo_invoice_mails m LEFT JOIN jo_users u ON u.loginId = m.sentBy WHERE m.invoiceNo = ? ORDER BY m.id DESC');
    $st->execute([$invoiceNo]);
    return array_map(static function ($r) {
        return [
            'id'         => (int) $r['id'],
            'method'     => (string) ($r['method'] ?? 'email'),
            'toAddr'     => (string) ($r['toAddr'] ?? ''),
            'ccAddr'     => (string) ($r['ccAddr'] ?? ''),
            'subject'    => (string) ($r['subject'] ?? ''),
            'driver'     => (string) ($r['driver'] ?? ''),
            'result'     => (string) ($r['result'] ?? ''),
            'isTest'     => (int) $r['isTest'],
            'errorText'  => (string) ($r['errorText'] ?? ''),
            'sentBy'     => (string) ($r['sentBy'] ?? ''),
            'sentByName' => (string) ($r['sentByName'] ?? ''),
            'createdAt'  => $r['createdAt'],
        ];
    }, $st->fetchAll());
}

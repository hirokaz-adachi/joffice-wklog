<?php
// 請求書 真正性検証ページ（公開・読取専用・最小開示）。
// PDF の QR から遷移。表示は PDF に既に載っている情報のみ（発行元・番号・発行日・合計・宛先名・ステータス）。
// トークン（128bit）で一意照合。無効・不一致は一律「無効」。明細・住所・社内メモは出さない。
declare(strict_types=1);

require_once __DIR__ . '/lib/helpers.php';
require_once __DIR__ . '/lib/db.php';

// 検索エンジンにインデックスさせない・キャッシュさせない
header('Content-Type: text/html; charset=UTF-8');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store, private');
header('Referrer-Policy: no-referrer');

$no = isset($_GET['no']) ? (string) $_GET['no'] : '';
$t  = isset($_GET['t'])  ? (string) $_GET['t']  : '';

// トークン形式（16進32〜64桁）以外は照合せず無効扱い（総当たり・不正入力の早期遮断）
$valid = false;
$row   = null;
if ($t !== '' && preg_match('/^[0-9a-f]{16,64}$/', $t)) {
    $db = jo_db();
    $st = $db->prepare('SELECT invoiceNo, issueDate, total, billToName, billToHonorific, status FROM jo_invoices WHERE verifyToken = ? LIMIT 1');
    $st->execute([$t]);
    $row = $st->fetch();
    // トークン一致に加え、URL の請求番号とも一致することを確認（多層防御）
    if ($row && ($no === '' || hash_equals((string) $row['invoiceNo'], $no))) {
        $valid = true;
    }
}

// 発行元名（表示用・最小限）
$issuerName = '';
if ($valid) {
    $s = jo_db()->prepare("SELECT settingValue FROM jo_app_settings WHERE settingKey = 'issuer.name' LIMIT 1");
    $s->execute();
    $issuerName = (string) ($s->fetchColumn() ?: '');
}

$esc  = static fn($v) => htmlspecialchars((string) ($v ?? ''), ENT_QUOTES, 'UTF-8');
$yen  = static fn($n) => number_format((float) ($n ?? 0));
$jdate = static function ($iso): string {
    $x = substr((string) ($iso ?? ''), 0, 10);
    return preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $x, $m) ? ($m[1] . '年' . $m[2] . '月' . $m[3] . '日') : '—';
};

$isVoid = $valid && $row['status'] === 'void';
?>
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>請求書 真正性の確認</title>
<style>
  :root { --ink:#1f2937; --muted:#6b7280; --line:#e5e7eb; --ok:#0f766e; --warn:#b45309; --bad:#b91c1c; }
  * { box-sizing:border-box; }
  body { margin:0; background:#eef2f3; color:var(--ink);
         font-family:"Yu Gothic","Hiragino Kaku Gothic ProN",Meiryo,sans-serif; }
  .wrap { max-width:520px; margin:32px auto; padding:0 16px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:10px; padding:22px 22px 18px;
          box-shadow:0 6px 20px rgba(0,0,0,.06); }
  h1 { font-size:16px; margin:0 0 4px; }
  .lead { font-size:12.5px; color:var(--muted); margin:0 0 16px; }
  .badge { display:inline-block; padding:4px 12px; border-radius:999px; font-size:12.5px; font-weight:700; }
  .badge.ok  { background:#e7f3f1; color:var(--ok); }
  .badge.void{ background:#fdeaea; color:var(--bad); }
  .badge.bad { background:#f3f4f6; color:var(--muted); }
  table.kv { width:100%; border-collapse:collapse; margin-top:16px; font-size:13.5px; }
  table.kv th, table.kv td { text-align:left; padding:9px 4px; border-bottom:1px solid var(--line); vertical-align:top; }
  table.kv th { color:var(--muted); font-weight:500; white-space:nowrap; width:38%; }
  table.kv td { font-weight:600; }
  .total { font-size:17px; }
  .note { font-size:11.5px; color:var(--muted); margin-top:16px; line-height:1.7; }
  .foot { text-align:center; font-size:11px; color:var(--muted); margin-top:14px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>請求書 真正性の確認</h1>
    <p class="lead">この画面は、お手元の請求書が発行システムの記録と一致するかを確認するものです。</p>

<?php if (!$valid): ?>
    <span class="badge bad">確認できません</span>
    <p class="note">
      無効な確認コードです。URL（QRコード）が正しいか、請求書に記載のQRから開いているかをご確認ください。
      なお、この画面では確認コードに紐づく請求書の要点のみを表示し、明細等の詳細は表示しません。
    </p>
<?php elseif ($isVoid): ?>
    <span class="badge void">この請求書は取消済みです</span>
    <table class="kv">
      <tr><th>発行元</th><td><?= $esc($issuerName) ?></td></tr>
      <tr><th>請求番号</th><td><?= $esc($row['invoiceNo']) ?></td></tr>
      <tr><th>宛先</th><td><?= $esc($row['billToName']) ?>　<?= $esc($row['billToHonorific']) ?></td></tr>
      <tr><th>状態</th><td>取消済み</td></tr>
    </table>
    <p class="note">
      この請求番号は取消されています。差し替え後の請求書をお持ちでない場合は、発行元へお問い合わせください。
    </p>
<?php else: ?>
    <span class="badge ok">発行元の記録と一致しました</span>
    <table class="kv">
      <tr><th>発行元</th><td><?= $esc($issuerName) ?></td></tr>
      <tr><th>請求番号</th><td><?= $esc($row['invoiceNo']) ?></td></tr>
      <tr><th>発行日</th><td><?= $esc($jdate($row['issueDate'])) ?></td></tr>
      <tr><th>宛先</th><td><?= $esc($row['billToName']) ?>　<?= $esc($row['billToHonorific']) ?></td></tr>
      <tr><th>ご請求金額（税込）</th><td class="total">¥<?= $esc($yen($row['total'])) ?></td></tr>
    </table>
    <p class="note">
      お手元の請求書に印字された金額・宛先が上記と一致していれば、この請求書は発行元から正規に発行されたものです。
      相違がある場合は、発行元へお問い合わせください。
    </p>
<?php endif; ?>

    <div class="foot">発行元システム: J-Office Invoice</div>
  </div>
</div>
</body>
</html>

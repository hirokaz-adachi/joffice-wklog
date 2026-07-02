<?php
// 請求書メール送付のドライバ抽象と本文テンプレート展開（invoice-feature-design §14）。
// 実送信は当面ダミー（SMTP ハンドオフのみスキップ・PDF 生成や履歴記録は本番同様）。
// 将来 SMTP 認証情報が届いたら SmtpMailer（PHPMailer・vendor 同梱）へ差し替える。API は不変。
declare(strict_types=1);

require_once __DIR__ . '/db.php';

// メール設定の既定値（jo_app_settings 未設定時のフォールバック）。
function jo_mail_defaults(): array
{
    return [
        'mail.driver'          => 'dummy',   // dummy / smtp
        'mail.fromName'        => '',
        'mail.fromAddress'     => '',
        'mail.replyTo'         => '',
        'mail.bccSelf'         => '',
        'mail.signature'       => '',
        'mail.subjectTemplate' => '請求書送付のご案内（請求番号 {{invoiceNo}}）',
        'mail.bodyTemplate'    => "{{customer}} {{honorific}}\n\nいつもお世話になっております。\n{{issuerName}} でございます。\n\n{{billingMonth}}分の請求書（請求番号 {{invoiceNo}}）を送付いたします。\n・ご請求金額：{{total}} 円（税込）\n・お支払期限：{{dueDate}}\n\n詳細は添付の PDF をご確認ください。\nご不明な点がございましたら本メールへご返信ください。\n\n{{signature}}",
    ];
}

// 既定 + jo_app_settings 上書きでメール設定を確定する。
function jo_mail_settings(array $settings): array
{
    $out = jo_mail_defaults();
    foreach ($out as $k => $v) {
        if (isset($settings[$k]) && $settings[$k] !== null && $settings[$k] !== '') {
            $out[$k] = (string) $settings[$k];
        }
    }
    return $out;
}

// プレースホルダ {{key}} を差込変数で置換する。未定義キーはそのまま残す。
function jo_mail_render_template(string $tpl, array $vars): string
{
    return (string) preg_replace_callback('/\{\{(\w+)\}\}/', static function ($m) use ($vars) {
        return array_key_exists($m[1], $vars) ? (string) $vars[$m[1]] : $m[0];
    }, $tpl);
}

// 請求書ヘッダ＋設定から本文差込変数を組み立てる。
function jo_mail_build_vars(array $header, array $settings): array
{
    $ym = (string) ($header['billingMonth'] ?? '');
    $ymLabel = preg_match('/^(\d{4})-(\d{2})$/', $ym, $mm) ? ($mm[1] . '年' . (int) $mm[2] . '月') : $ym;
    return [
        'customer'     => (string) ($header['billToName'] ?? ''),
        'honorific'    => (string) ($header['billToHonorific'] ?? '御中'),
        'invoiceNo'    => (string) ($header['invoiceNo'] ?? ''),
        'billingMonth' => $ymLabel,
        'subject'      => (string) ($header['subject'] ?? ''),
        'total'        => number_format((int) ($header['total'] ?? 0)),
        'dueDate'      => (string) ($header['dueDate'] ?? ''),
        'issuerName'   => (string) ($settings['issuer.name'] ?? ''),
        'signature'    => (string) ($settings['mail.signature'] ?? ''),
    ];
}

// カンマ／セミコロン／空白区切りのアドレス文字列を配列へ（空要素除去）。
function jo_mail_parse_addrs(string $s): array
{
    $out = [];
    foreach (preg_split('/[,;\s]+/', trim($s)) ?: [] as $p) {
        $p = trim((string) $p);
        if ($p !== '') {
            $out[] = $p;
        }
    }
    return $out;
}

// メール送出。ドライバに応じて実送信 or ダミー。
// $msg: ['to'(配列),'cc','bcc','subject','body','fromName','fromAddress','replyTo','pdf'(bytes),'pdfName']
// 返り値: ['ok'=>bool,'messageId'=>string,'error'=>string,'driver'=>string]
function jo_mail_send(array $msg, string $driver = 'dummy'): array
{
    if ($driver === 'smtp') {
        // 将来 PHPMailer で実装。未設定のまま実送信を試みない（誤送信・例外の防止）。
        return ['ok' => false, 'messageId' => '', 'error' => 'smtp_not_configured', 'driver' => 'smtp'];
    }
    // dummy: 呼び出し側で PDF 生成まで済ませた $msg を受け取り、SMTP 送出のみスキップして成功を返す。
    return ['ok' => true, 'messageId' => 'dummy-' . bin2hex(random_bytes(6)), 'error' => '', 'driver' => 'dummy'];
}

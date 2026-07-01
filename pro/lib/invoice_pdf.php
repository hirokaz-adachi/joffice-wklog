<?php
// 請求書 PDF レンダラ（mPDF・サーバ生成）。
// invoice-print.html（HTML印刷ビュー）と同一レイアウトを mPDF 互換（Flex→テーブル）へ移植。
// 日本語フォントは IPAex ゴシック（pro/assets/fonts/ipaexg.ttf）を埋め込む。
declare(strict_types=1);

/**
 * 請求書 PDF を生成する。
 *
 * @param array $h        ヘッダ（jo_invoices 相当）
 * @param array $lines    明細（jo_invoice_lines 相当の配列）
 * @param array $settings jo_app_settings のキーバリュー（issuer.* 等）
 * @param array $opts     ['dest'=>'S'|'F', 'path'=>string, 'tempDir'=>string]
 * @return string         dest='S' のとき PDF バイナリ文字列。dest='F' は空文字。
 */
function jo_render_invoice_pdf(array $h, array $lines, array $settings, array $opts = []): string
{
    require_once dirname(__DIR__) . '/vendor/autoload.php';

    $tempDir = $opts['tempDir'] ?? (sys_get_temp_dir() . '/mpdf');
    if (!is_dir($tempDir)) { @mkdir($tempDir, 0775, true); }

    $fontCustomDir = dirname(__DIR__) . '/assets/fonts';

    $cfgVars  = (new \Mpdf\Config\ConfigVariables())->getDefaults();
    $fontVars = (new \Mpdf\Config\FontVariables())->getDefaults();

    $mpdf = new \Mpdf\Mpdf([
        'mode'           => 'utf-8',
        'format'         => 'A4',
        'margin_left'    => 12,
        'margin_right'   => 12,
        'margin_top'     => 12,
        'margin_bottom'  => 12,
        'margin_header'  => 0,
        'margin_footer'  => 0,
        'tempDir'        => $tempDir,
        'fontDir'        => array_merge($cfgVars['fontDir'], [$fontCustomDir]),
        'fontdata'       => $fontVars['fontdata'] + [
            'notosansjp' => ['R' => 'NotoSansJP-Regular.ttf', 'B' => 'NotoSansJP-Bold.ttf'],
        ],
        'default_font'      => 'notosansjp',
        'default_font_size' => 9.5,
    ]);
    $mpdf->SetTitle('請求書 ' . (string) ($h['invoiceNo'] ?? ''));
    $mpdf->SetAuthor((string) ($settings['issuer.name'] ?? ''));

    $html = jo_invoice_pdf_html($h, $lines, $settings);
    $mpdf->WriteHTML($html);

    $dest = $opts['dest'] ?? 'S';
    if ($dest === 'F') {
        $mpdf->Output($opts['path'] ?? (sys_get_temp_dir() . '/invoice.pdf'), \Mpdf\Output\Destination::FILE);
        return '';
    }
    return $mpdf->Output('', \Mpdf\Output\Destination::STRING_RETURN);
}

/** 請求書 HTML（mPDF 互換・テーブルレイアウト）を組み立てる。 */
function jo_invoice_pdf_html(array $h, array $lines, array $settings): string
{
    $esc  = static fn($v) => htmlspecialchars((string) ($v ?? ''), ENT_QUOTES, 'UTF-8');
    $yen  = static fn($n) => number_format((float) ($n ?? 0));
    $jdate = static function ($iso): string {
        $s = substr((string) ($iso ?? ''), 0, 10);
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $s, $m)) {
            return $m[1] . '年' . $m[2] . '月' . $m[3] . '日';
        }
        return '—';
    };

    $MIN_ROWS = 8;

    $regNo  = (string) ($h['issuerRegNo'] ?? $settings['issuer.regNo'] ?? '');
    $noRaw  = (string) ($h['invoiceNo'] ?? '');
    $noDisp = preg_match('/^draft_/', $noRaw) ? '（下書き・未採番）' : $noRaw;
    $honor  = (string) ($h['billToHonorific'] ?? '御中');

    // 税率ごと集計
    $byRate = [];
    foreach ($lines as $l) {
        $r = (int) ($l['taxRate'] ?? 10);
        $byRate[$r] = ($byRate[$r] ?? 0) + (float) ($l['amount'] ?? 0);
    }
    ksort($byRate);
    $taxRows = '';
    foreach ($byRate as $r => $net) {
        $tax = (int) floor($net * $r / 100);
        $taxRows .= '<tr><td class="k">税抜（' . $r . '%）</td><td class="v">' . $yen($net) . '</td></tr>';
        $taxRows .= '<tr><td class="k">消費税（' . $r . '%）</td><td class="v">' . $yen($tax) . '</td></tr>';
    }

    // 明細行（4列）＋空行
    $rowsHtml = '';
    foreach ($lines as $l) {
        $rowsHtml .= '<tr>'
            . '<td class="name">' . $esc($l['itemName'] ?? '') . '</td>'
            . '<td class="num">' . $yen($l['unitPrice'] ?? 0) . '</td>'
            . '<td class="num">' . ((int) ($l['quantity'] ?? 0)) . '</td>'
            . '<td class="num">' . $yen($l['amount'] ?? 0) . '</td>'
            . '</tr>';
    }
    for ($i = count($lines); $i < $MIN_ROWS; $i++) {
        $rowsHtml .= '<tr class="blank"><td class="name">&nbsp;</td><td class="num"></td><td class="num"></td><td class="num"></td></tr>';
    }

    // 発行者ブロック（発行者名は太字・フル幅独立行。住所等＋角印は下段に併置）
    $iname = $settings['issuer.name'] ? $esc($settings['issuer.name']) : '<span class="warn">（発行者名 未設定）</span>';
    $issuerName = '<div class="issuer-name">' . $iname . '</div>';
    $issuerDetails = '<div class="issuer-text">'
        . ($regNo ? '登録番号：' . $esc($regNo) : '<span class="warn">登録番号：（未設定）</span>') . '<br>'
        . ($settings['issuer.address'] ? $esc($settings['issuer.address']) . '<br>' : '')
        . ($settings['issuer.tel'] ? 'TEL：' . $esc($settings['issuer.tel']) : '')
        . '</div>';

    $sealSrc  = ((string) ($settings['issuer.sealImage'] ?? '')) ?: 'assets/issuer-seal.png';
    $sealPath = dirname(__DIR__) . '/' . ltrim($sealSrc, '/');
    $sealHtml = is_file($sealPath)
        ? '<img src="' . $esc($sealPath) . '" width="64" height="64" style="object-fit:contain;">'
        : '';

    $bank = $settings['issuer.bank'] ? $esc($settings['issuer.bank']) : '<span class="warn">（振込先 未設定）</span>';

    $billAddr  = $h['billToAddress'] ? '<div class="to-addr">' . nl2br($esc($h['billToAddress'])) . '</div>' : '';
    $subject   = $h['subject'] ? '<div class="subject"><span class="lbl">件名：</span>' . $esc($h['subject']) . '</div>' : '';
    $remarks   = $h['remarks'] ? nl2br($esc($h['remarks'])) : '';

    $footNote = '本請求書は適格請求書（インボイス）として発行しています。'
        . ($regNo ? '' : '※登録番号は発行者設定で登録してください。');

    // ===== mPDF 互換 CSS（flex 不使用・テーブルと width% で構成） =====
    $css = <<<CSS
@page { margin: 13mm; }
body { font-family: notosansjp, sans-serif; color:#1f2937; font-size:9.5pt; line-height:1.65; }
.tbl-layout { width:100%; border-collapse:collapse; }
.tbl-layout > td { vertical-align:top; }

.title-tbl { width:84mm; border-collapse:collapse; }
.doc-title { font-size:22px; font-weight:bold; text-align:center;
  background:#e5e7eb; padding:8px 0; border-radius:3px; }
.doc-meta { text-align:right; font-size:9.5pt; line-height:2.0; padding-top:6px; }

.to-name { font-size:13.5pt; font-weight:bold; border-bottom:1.2px solid #1f2937; padding-bottom:5px; }
.to-addr { color:#374151; font-size:9pt; line-height:1.85; }
.subject { font-size:11.5pt; line-height:1.6; }
.subject .lbl { color:#6b7280; }
.greeting { font-size:9pt; line-height:1.95; color:#374151; }
.hsp { font-size:8pt; line-height:8pt; }

.issuer-text { font-size:9.5pt; line-height:1.95; }
.issuer-name { font-size:11.5pt; font-weight:bold; }
.warn { color:#b45309; }

.total-box { border-collapse:collapse; border:1.6px solid #1f2937; margin-top:20px; border-radius:4px; }
.total-box td { padding:12px 16px; }
.total-box .lbl { background:#e5e7eb; font-size:10.5pt; font-weight:bold; white-space:nowrap; }
.total-box .val { text-align:right; font-size:18pt; font-weight:bold; }

table.items { width:100%; border-collapse:collapse; font-size:9pt; margin-top:16px; }
table.items th, table.items td { border:0.6px solid #9ca3af; padding:7px 9px; }
table.items th { background:#f1f5f9; color:#334155; font-weight:bold; text-align:center; }
table.items td.name { text-align:left; }
table.items td.num, table.items th.num { text-align:right; }
table.items tr.blank td { height:26px; }

table.tax { border-collapse:collapse; font-size:9pt; width:100%; }
table.tax td { border:0.6px solid #9ca3af; padding:7px 11px; }
table.tax td.k { background:#f8fafc; color:#334155; }
table.tax td.v { text-align:right; }
table.tax tr.grand td { font-weight:bold; font-size:10.5pt; background:#eef2f3; }

table.pay { border-collapse:collapse; font-size:9.5pt; }
table.pay td.k { color:#6b7280; padding:3px 18px 3px 0; white-space:nowrap; }
table.pay td.v { padding:3px 0; line-height:1.7; }

.remarks-lbl { font-size:8.5pt; color:#6b7280; margin-bottom:4px; }
.remarks-tbl { width:100%; border-collapse:collapse; }
.remarks-box { border:0.6px solid #9ca3af; border-radius:3px; height:30mm; vertical-align:top; padding:10px 12px; font-size:9pt; line-height:1.85; }
.foot-note { color:#6b7280; font-size:8pt; margin-top:14px; }
CSS;

    // ===== 本文（テーブル構成） =====
    $html = '<html><head><style>' . $css . '</style></head><body>';

    // 見出し帯＋請求日/番号（2列テーブル）
    $html .= '<table class="tbl-layout"><tr>'
        . '<td><table class="title-tbl"><tr><td class="doc-title" align="center">御 請 求 書</td></tr></table></td>'
        . '<td style="text-align:right; vertical-align:top;"><div class="doc-meta">'
        .   '<div>請求日：<b>' . $jdate($h['issueDate'] ?? '') . '</b></div>'
        .   '<div class="hsp">&nbsp;</div>'
        .   '<div>請求番号：<b>' . $esc($noDisp) . '</b></div>'
        .   '</div></td>'
        . '</tr></table>';

    // 宛先＋発行者（2列テーブル）。発行者セルは内側で「テキスト｜角印」の2列。
    $html .= '<table class="tbl-layout" style="margin-top:10px;"><tr>'
        . '<td width="49%">'
        .   '<div class="to-name">' . $esc($h['billToName'] ?? '') . '　' . $esc($honor) . '</div>'
        .   ($billAddr ? '<div class="hsp">&nbsp;</div>' . $billAddr : '')
        .   ($subject ? '<div class="hsp">&nbsp;</div>' . $subject : '')
        .   '<div class="hsp">&nbsp;</div>'
        .   '<div class="greeting">いつもご利用ありがとうございます。<br>下記の通りご請求申し上げます。</div>'
        . '</td>'
        . '<td width="3%"></td>'
        . '<td width="48%">'
        .   '<table style="width:100%; border-collapse:collapse;"><tr>'
        .     '<td style="vertical-align:top;">'
        .       $issuerName
        .       '<div class="hsp">&nbsp;</div>'
        .       $issuerDetails
        .     '</td>'
        .     '<td width="66" style="vertical-align:top; text-align:right;">' . $sealHtml . '</td>'
        .   '</tr></table>'
        . '</td>'
        . '</tr></table>';

    // ご請求金額（税込）
    $html .= '<table class="total-box"><tr>'
        . '<td class="lbl">ご請求金額（税込）</td>'
        . '<td class="val" width="220">¥' . $yen($h['total'] ?? 0) . '</td>'
        . '</tr></table>';

    // 明細表
    $html .= '<table class="items"><thead><tr>'
        . '<th class="name">品名</th>'
        . '<th class="num" width="18%">単価（税抜）</th>'
        . '<th class="num" width="12%">数量</th>'
        . '<th class="num" width="20%">金額（税抜）</th>'
        . '</tr></thead><tbody>' . $rowsHtml . '</tbody></table>';

    // 支払情報（左）＋税サマリ（右）を2列テーブルで併置
    $html .= '<table class="tbl-layout" style="margin-top:16px;"><tr>'
        . '<td width="50%">'
        .   '<table class="pay"><tr><td class="k">支払期限</td><td class="v">' . $jdate($h['dueDate'] ?? '') . '</td></tr>'
        .   '<tr><td class="k">振込先</td><td class="v">' . $bank . '</td></tr></table>'
        . '</td>'
        . '<td width="2%"></td>'
        . '<td width="48%">'
        .   '<table class="tax">' . $taxRows
        .   '<tr class="grand"><td class="k">合計（税込）</td><td class="v">¥' . $yen($h['total'] ?? 0) . '</td></tr>'
        .   '</table>'
        . '</td>'
        . '</tr></table>';

    // 備考
    $html .= '<div style="margin-top:18px;"><div class="remarks-lbl">備考</div>'
        . '<table class="remarks-tbl"><tr><td class="remarks-box">' . ($remarks !== '' ? $remarks : '&nbsp;') . '</td></tr></table></div>';

    // 適格請求書フッター
    $html .= '<div class="foot-note">' . $footNote . '</div>';

    $html .= '</body></html>';
    return $html;
}

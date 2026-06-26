<?php
// JOffice アプリアイコンの配信用縮小版を生成（gd・アルファ保持）。
// 入力: assets/icons/{j-office,j-office-insight,j-office-invoice}.png（各1024px）
// 出力: pro/assets/icons/<name>-<size>.png（32/96/180/192/512）
// 使い方: php scripts/gen-icons.php   （リポジトリ直下で実行）
declare(strict_types=1);

$root = dirname(__DIR__);
$src = $root . '/assets/icons';
$dst = $root . '/pro/assets/icons';
if (!is_dir($dst)) { mkdir($dst, 0777, true); }

$icons = ['j-office', 'j-office-insight', 'j-office-invoice'];
$sizes = [32, 96, 180, 192, 512];

function resize(string $in, string $out, int $size): void
{
    $img = imagecreatefrompng($in);
    $w = imagesx($img); $h = imagesy($img);
    $o = imagecreatetruecolor($size, $size);
    imagealphablending($o, false);
    imagesavealpha($o, true);
    imagefilledrectangle($o, 0, 0, $size, $size, imagecolorallocatealpha($o, 0, 0, 0, 127));
    imagecopyresampled($o, $img, 0, 0, 0, 0, $size, $size, $w, $h);
    imagepng($o, $out, 9);
    imagedestroy($img); imagedestroy($o);
}

foreach ($icons as $name) {
    $in = "$src/$name.png";
    if (!is_file($in)) { fwrite(STDERR, "missing: $in\n"); continue; }
    foreach ($sizes as $s) {
        resize($in, "$dst/$name-$s.png", $s);
        echo "$name-$s.png\n";
    }
}

<?php
// 初期管理者を1回だけ作成するスクリプト。
// 使い方（実機・ブラウザ or curl）:
//   /joffice-pro/setup_admin.php?setupKey=（config の setup_key）&loginId=admin&password=（8文字以上）&displayName=管理者
//   既にユーザーが存在する場合は 409。追加するなら &force=1。
// 実行後は必ずこのファイルを削除してください（残すと攻撃面になる）。
declare(strict_types=1);

require_once __DIR__ . '/lib/helpers.php';
require_once __DIR__ . '/lib/db.php';

$in = jo_input();

$setupKey = (string) ($in['setupKey'] ?? '');
$expected = (string) (jo_config('setup_key') ?? '');
if ($expected === '' || !hash_equals($expected, $setupKey)) {
    jo_error('setup_key required or invalid', 403);
}

$db = jo_db();
$cnt = (int) $db->query('SELECT COUNT(*) AS c FROM jo_users')->fetch()['c'];
if ($cnt > 0 && empty($in['force'])) {
    jo_error('users already exist (add &force=1 to create another)', 409);
}

$loginId  = trim((string) ($in['loginId'] ?? ''));
$password = (string) ($in['password'] ?? '');
$display  = (string) ($in['displayName'] ?? 'Administrator');
if ($loginId === '' || strlen($password) < 8) {
    jo_error('loginId and password (>= 8 chars) required', 400);
}

$hash = password_hash($password, PASSWORD_BCRYPT);
$st = $db->prepare(
    'INSERT INTO jo_users (loginId, passwordHash, role, displayName, isActive, mustChangePassword, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 1, 0, NOW(), NOW())'
);
$st->execute([$loginId, $hash, 'admin', $display]);

jo_json([
    'ok'      => true,
    'created' => $loginId,
    'role'    => 'admin',
    'note'    => 'このファイル(setup_admin.php)は実行後に必ず削除してください。',
]);

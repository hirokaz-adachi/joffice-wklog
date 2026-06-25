<?php
// ユーザー管理（jo_users）。listUsers/saveUser/deleteUser は admin、changePassword は本人。
declare(strict_types=1);

require_once __DIR__ . '/db.php';

function jo_list_users(): array
{
    $st = jo_db()->query('SELECT id, loginId, role, staffCode, displayName, isActive, mustChangePassword, lastLoginAt FROM jo_users ORDER BY loginId');
    return array_map(static function ($r) {
        return [
            'id'                 => (int) $r['id'],
            'loginId'            => (string) $r['loginId'],
            'role'               => (string) $r['role'],
            'staffCode'          => (string) ($r['staffCode'] ?? ''),
            'displayName'        => (string) ($r['displayName'] ?? ''),
            'isActive'           => (int) $r['isActive'],
            'mustChangePassword' => (int) $r['mustChangePassword'],
            'lastLoginAt'        => $r['lastLoginAt'],
        ];
    }, $st->fetchAll());
}

// 作成 or 更新。password 指定時のみハッシュ更新。新規は password 必須。
function jo_save_user(array $in): array
{
    $db = jo_db();
    $loginId = trim((string) ($in['loginId'] ?? ''));
    if ($loginId === '') {
        throw new InvalidArgumentException('loginId_required');
    }
    $role = (string) ($in['role'] ?? 'staff');
    if (!in_array($role, ['admin', 'manager', 'staff'], true)) {
        throw new InvalidArgumentException('invalid_role');
    }
    $staffCode = trim((string) ($in['staffCode'] ?? ''));
    if ($staffCode === '') {
        $staffCode = null;
    }
    $displayName = (string) ($in['displayName'] ?? '');
    $isActive = (int) ($in['isActive'] ?? 1);
    $must = array_key_exists('mustChangePassword', $in) ? (int) $in['mustChangePassword'] : null;
    $password = (string) ($in['password'] ?? '');
    $id = (isset($in['id']) && $in['id'] !== '') ? (int) $in['id'] : 0;
    $now = date('Y-m-d H:i:s');

    // loginId 重複チェック（自分以外）
    $chk = $db->prepare('SELECT id FROM jo_users WHERE loginId = ? LIMIT 1');
    $chk->execute([$loginId]);
    $exist = $chk->fetch();
    if ($exist && (int) $exist['id'] !== $id) {
        throw new InvalidArgumentException('loginId_duplicate');
    }

    if ($id > 0) {
        $cols = [
            'loginId'     => $loginId,
            'role'        => $role,
            'staffCode'   => $staffCode,
            'displayName' => $displayName,
            'isActive'    => $isActive,
            'updatedAt'   => $now,
        ];
        if ($must !== null) {
            $cols['mustChangePassword'] = $must;
        }
        if ($password !== '') {
            if (strlen($password) < 8) {
                throw new InvalidArgumentException('password_too_short');
            }
            $cols['passwordHash'] = password_hash($password, PASSWORD_BCRYPT);
        }
        $sets = implode(', ', array_map(static fn($c) => "`$c` = ?", array_keys($cols)));
        $db->prepare("UPDATE jo_users SET $sets WHERE id = ?")->execute(array_merge(array_values($cols), [$id]));
        return ['id' => $id, 'loginId' => $loginId];
    }

    // 新規作成
    if (strlen($password) < 8) {
        throw new InvalidArgumentException('password_required_min8');
    }
    if ($must === null) {
        $must = 1; // 新規は既定で初回変更要求
    }
    $hash = password_hash($password, PASSWORD_BCRYPT);
    $db->prepare('INSERT INTO jo_users (loginId, passwordHash, role, staffCode, displayName, isActive, mustChangePassword, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)')
       ->execute([$loginId, $hash, $role, $staffCode, $displayName, $isActive, $must, $now, $now]);
    return ['id' => (int) $db->lastInsertId(), 'loginId' => $loginId];
}

function jo_delete_user(int $id, array $sessionUser): void
{
    if ($id === (int) ($sessionUser['id'] ?? 0)) {
        throw new InvalidArgumentException('cannot_delete_self');
    }
    jo_db()->prepare('DELETE FROM jo_users WHERE id = ?')->execute([$id]);
}

// 本人パスワード変更。成功で mustChangePassword=0。
function jo_change_password(array $sessionUser, string $current, string $next): array
{
    if (strlen($next) < 8) {
        throw new InvalidArgumentException('new_password_too_short');
    }
    $db = jo_db();
    $st = $db->prepare('SELECT passwordHash FROM jo_users WHERE id = ?');
    $st->execute([(int) $sessionUser['id']]);
    $u = $st->fetch();
    if (!$u || !password_verify($current, $u['passwordHash'])) {
        throw new InvalidArgumentException('current_password_mismatch');
    }
    $hash = password_hash($next, PASSWORD_BCRYPT);
    $db->prepare('UPDATE jo_users SET passwordHash = ?, mustChangePassword = 0, updatedAt = NOW() WHERE id = ?')
       ->execute([$hash, (int) $sessionUser['id']]);
    return ['ok' => true];
}

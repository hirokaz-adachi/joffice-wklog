-- =====================================================================
-- マイグレーション: jo_users.staffCode を UNIQUE 化（1スタッフ=1ユーザー）
-- 対象 : 既存の 2vt7g_joffice_pro（staging）。新規構築は schema.sql に反映済み。
-- 適用 : 2026-06-26 / HLS（adachi）
-- 背景 : 同一スタッフを複数ユーザーが「本人所有」できてしまう穴を塞ぐ。
--        NULL（紐付けなし）は MySQL の UNIQUE が複数許容するため制約対象外。
-- 注意 : MySQL 5.7。適用前に下記 STEP1 で重複が無いことを必ず確認すること。
--        重複(count>1)があると STEP3 の ADD UNIQUE が ERROR 1062 で失敗する。
-- =====================================================================
SET NAMES utf8mb4;

-- STEP1: 重複している staffCode を検出（0件であることを確認）。
--        1件以上返る場合は、該当ユーザーのどちらかの紐付けを外してから STEP2 以降へ。
SELECT staffCode, COUNT(*) AS cnt
FROM jo_users
WHERE staffCode IS NOT NULL AND staffCode <> ''
GROUP BY staffCode
HAVING cnt > 1;

-- STEP1.5: 空文字の staffCode を NULL に正規化（'' は UNIQUE では重複扱いになるため）。
UPDATE jo_users SET staffCode = NULL WHERE staffCode = '';

-- STEP2: 旧来の非ユニークインデックス idx_user_staff を削除（uq_user_staff が代替）。
--        ※ FK fk_user_staff が idx_user_staff を使っている場合、先に外す必要があるため、
--          いったん FK を落として張り直す。
ALTER TABLE jo_users DROP FOREIGN KEY fk_user_staff;
ALTER TABLE jo_users DROP INDEX idx_user_staff;

-- STEP3: UNIQUE 制約を追加（NULL は複数許容＝紐付けなしは無制限）。
ALTER TABLE jo_users ADD UNIQUE KEY uq_user_staff (staffCode);

-- STEP4: FK を張り直す（uq_user_staff のインデックスを利用）。
ALTER TABLE jo_users
  ADD CONSTRAINT fk_user_staff FOREIGN KEY (staffCode) REFERENCES jo_staff(code) ON DELETE SET NULL;

-- 確認: インデックス構成を表示。
-- SHOW INDEX FROM jo_users;

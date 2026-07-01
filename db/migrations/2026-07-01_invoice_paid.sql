-- =====================================================================
-- マイグレーション: jo_invoices に paidDate / paidBy（入金状況・手動消込）を追加
-- 対象 : 既存の 2vt7g_joffice_pro（staging）。新規構築は schema.sql に反映済み。
-- 適用 : 2026-07-01 / HLS（adachi）
-- 背景 : 請求書一覧で入金状況（未入金/入金済/期限超過）を管理するため。
--        入金状態は lifecycle の status とは独立に持つ（発行済＋送付済＋入金済 を
--        同時表現できるようにするため。status='paid' は使わない）。
--        入金状況は paidDate（NULL=未入金）＋ dueDate から派生表示。手動消込。
-- 注意 : MySQL 5.7。NULL 許容のため既存データへの影響なし（後方互換・既存は未入金扱い）。
--        冪等化のため実行ランナー側で information_schema を見て未追加時のみ ALTER する。
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE jo_invoices
  ADD COLUMN paidDate DATE NULL AFTER verifyToken,
  ADD COLUMN paidBy   VARCHAR(50) NULL AFTER paidDate;

-- 確認:
-- SHOW COLUMNS FROM jo_invoices LIKE 'paidDate';
-- SHOW COLUMNS FROM jo_invoices LIKE 'paidBy';

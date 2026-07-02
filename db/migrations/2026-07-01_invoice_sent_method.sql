-- =====================================================================
-- マイグレーション: 請求書の送付チャネル（メール/郵送）対応（§14 拡張）
-- 対象 : 既存の 2vt7g_joffice_pro（staging）。新規構築は schema.sql に反映済み。
-- 適用 : 2026-07-01 / HLS（adachi）
-- 背景 : 請求書の送付はメールだけでなく PDF 印刷→郵送のケースもある。
--        送付済（sentDate）をチャネル非依存の状態とし、手段（email/post）を併記する。
-- 注意 : MySQL 5.7。NULL/DEFAULT 付きで後方互換。冪等化は実行ランナーが
--        information_schema を見て未追加時のみ ALTER する。
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE jo_invoices
  ADD COLUMN sentMethod VARCHAR(10) NULL AFTER sentCount;   -- 最後の送付手段 email/post

ALTER TABLE jo_invoice_mails
  ADD COLUMN method VARCHAR(10) NOT NULL DEFAULT 'email' AFTER invoiceNo;  -- 送付手段 email/post

-- 確認:
-- SHOW COLUMNS FROM jo_invoices LIKE 'sentMethod';
-- SHOW COLUMNS FROM jo_invoice_mails LIKE 'method';

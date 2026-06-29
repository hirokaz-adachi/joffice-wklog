-- =====================================================================
-- マイグレーション: jo_invoices に subject（件名）カラムを追加
-- 対象 : 既存の 2vt7g_joffice_pro（staging）。新規構築は schema.sql に反映済み。
-- 適用 : 2026-06-29 / HLS（adachi）
-- 背景 : 請求書PDFに「件名」（例「DX推進サポートサービス（2026年3月分）」）を
--        表示するため、ヘッダに表題フィールドを新設する。既存行は NULL（件名なし）。
-- 注意 : MySQL 5.7。NULL 許容のため既存データへの影響なし（後方互換）。冪等化のため
--        実行ランナー側で information_schema を見て未追加時のみ ALTER する。
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE jo_invoices
  ADD COLUMN subject VARCHAR(120) NULL AFTER billToAddress;

-- 確認:
-- SHOW COLUMNS FROM jo_invoices LIKE 'subject';

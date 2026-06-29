-- =====================================================================
-- マイグレーション: jo_invoices に remarks（備考・PDF表示）カラムを追加
-- 対象 : 既存の 2vt7g_joffice_pro（staging）。新規構築は schema.sql に反映済み。
-- 適用 : 2026-06-29 / HLS（adachi）
-- 背景 : 請求書PDFに表示する「備考」を、社内専用の memo とは別に持たせる。
--        従来は memo を備考欄に流用していたが、社内メモ(PDF非表示)と分離する。
-- 注意 : MySQL 5.7。NULL 許容のため既存データへの影響なし（後方互換）。冪等化のため
--        実行ランナー側で information_schema を見て未追加時のみ ALTER する。
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE jo_invoices
  ADD COLUMN remarks TEXT NULL AFTER memo;

-- 確認:
-- SHOW COLUMNS FROM jo_invoices LIKE 'remarks';

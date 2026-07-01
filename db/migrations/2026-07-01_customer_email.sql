-- =====================================================================
-- マイグレーション: jo_customers に email（送付先To）/ ccEmail（送付CC）を追加
-- 対象 : 既存の 2vt7g_joffice_pro（staging）。新規構築は schema.sql に反映済み。
-- 適用 : 2026-07-01 / HLS（adachi）
-- 背景 : 請求書のメール送信（後フェーズ・invoice-feature-design §14）に向けた下準備。
--        顧客ごとの請求書送付先メールアドレスを顧客マスタで管理する。
--        いずれも任意（NULL可）・カンマ区切りで複数アドレスを保持できる想定。
-- 注意 : MySQL 5.7。NULL 許容のため既存データへの影響なし（後方互換）。冪等化のため
--        実行ランナー側で information_schema を見て未追加時のみ ALTER する。
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE jo_customers
  ADD COLUMN email   VARCHAR(255) NULL AFTER contactName,
  ADD COLUMN ccEmail VARCHAR(255) NULL AFTER email;

-- 確認:
-- SHOW COLUMNS FROM jo_customers LIKE 'email';
-- SHOW COLUMNS FROM jo_customers LIKE 'ccEmail';

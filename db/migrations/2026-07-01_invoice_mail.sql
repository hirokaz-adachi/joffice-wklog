-- =====================================================================
-- マイグレーション: 請求書メール送付（§14）— 送信状態列 ＋ 送信履歴テーブル
-- 対象 : 既存の 2vt7g_joffice_pro（staging）。新規構築は schema.sql に反映済み。
-- 適用 : 2026-07-01 / HLS（adachi）
-- 背景 : 請求書のメール送付。送信状態は入金(paidDate)と同じ独立カラム方式で保持
--        （status enum は触らない。発行×送信×入金の直交した組合せを矛盾なく表現）。
--        実送信は当面ダミードライバ（SMTP ハンドオフのみスキップ）。履歴は本番同様に記録。
-- 注意 : MySQL 5.7。追加列は NULL/DEFAULT 付きで後方互換。冪等化は実行ランナーが
--        information_schema を見て未追加時のみ ALTER / CREATE する。
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE jo_invoices
  ADD COLUMN sentDate  DATE NULL              AFTER paidBy,
  ADD COLUMN sentBy    VARCHAR(50) NULL       AFTER sentDate,
  ADD COLUMN sentCount INT NOT NULL DEFAULT 0 AFTER sentBy;

CREATE TABLE IF NOT EXISTS jo_invoice_mails (   -- 請求書メール送信履歴（アウトボックス）
  id        BIGINT NOT NULL AUTO_INCREMENT,
  invoiceNo VARCHAR(30) NOT NULL,
  toAddr    VARCHAR(500) NULL,                   -- To（カンマ区切りスナップショット）
  ccAddr    VARCHAR(500) NULL,
  subject   VARCHAR(255) NULL,
  body      TEXT NULL,                           -- 実際に送った本文スナップショット
  pdfName   VARCHAR(120) NULL,
  driver    VARCHAR(20) NOT NULL DEFAULT 'dummy',-- dummy / smtp
  result    ENUM('sent','failed','test') NOT NULL DEFAULT 'sent',
  isTest    TINYINT(1) NOT NULL DEFAULT 0,       -- テスト送信（送信状況を更新しない）
  errorText TEXT NULL,
  sentBy    VARCHAR(50) NULL,                    -- 送信操作者（loginId）
  createdAt DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_mail_inv (invoiceNo),
  CONSTRAINT fk_mail_inv FOREIGN KEY (invoiceNo) REFERENCES jo_invoices(invoiceNo) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 確認:
-- SHOW COLUMNS FROM jo_invoices LIKE 'sentDate';
-- SHOW COLUMNS FROM jo_invoices LIKE 'sentCount';
-- SHOW TABLES LIKE 'jo_invoice_mails';

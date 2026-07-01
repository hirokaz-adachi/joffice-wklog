-- =====================================================================
-- マイグレーション: jo_invoices に verifyToken（真正性検証・QR用の照合鍵）を追加
-- 対象 : 既存の 2vt7g_joffice_pro（staging）。新規構築は schema.sql に反映済み。
-- 適用 : 2026-07-01 / HLS（adachi）
-- 背景 : 請求書PDFにQRを載せ、公開の検証ページ（verify.php）で発行元・番号・
--        金額・発行日・ステータスを照合できるようにする（invoice-feature-design §11/§13）。
--        トークンは128bit乱数（発行時 bin2hex(random_bytes(16)) で生成）。
-- 注意 : MySQL 5.7。NULL 許容のため既存データへの影響なし（後方互換）。冪等化のため
--        実行ランナー側で information_schema を見て未追加時のみ ALTER する。
--        既存の発行済み/取消 行への遡及付与は、生成方式を発行時と揃えるため
--        ランナー（PHP）側で bin2hex(random_bytes(16)) を1行ずつ UPDATE する。
-- =====================================================================
SET NAMES utf8mb4;

ALTER TABLE jo_invoices
  ADD COLUMN verifyToken VARCHAR(64) NULL AFTER remarks,
  ADD KEY idx_inv_verify (verifyToken);

-- 遡及付与（参考・実際はランナーが1行ずつ乱数生成）:
-- UPDATE jo_invoices SET verifyToken = SUBSTRING(SHA2(CONCAT(invoiceNo, UUID(), RAND()),256),1,32)
--   WHERE status IN ('issued','void') AND (verifyToken IS NULL OR verifyToken='');

-- 確認:
-- SHOW COLUMNS FROM jo_invoices LIKE 'verifyToken';

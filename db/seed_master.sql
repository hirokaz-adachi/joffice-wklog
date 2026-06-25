-- =====================================================================
-- マスタ初期投入：業務区分カタログ（確定15コード・design.md 第8-12）
--   + 工程（Prepare/Review = PRE/REV・全15コード×2＝30行）
--   + 設定（作業→請求オフセット）
-- 冪等：ON DUPLICATE KEY UPDATE。schema.sql 適用後に phpMyAdmin で流す。
-- 注意：顧客・スタッフは実データ移行で投入（ここには含めない＝PIIのため）。
-- =====================================================================
SET NAMES utf8mb4;

-- 業務区分（役務=service / 配賦対象外=excluded / 税=tax）
INSERT INTO jo_task_types (code, name, allocationType, sortOrder) VALUES
  ('001', '労務相談',             'service',  1),
  ('002', '事務長代行費用',       'service',  2),
  ('003', '有給休暇管理費用',     'service',  3),
  ('026', '給与計算',             'service',  4),
  ('027', 'FBデータ作成費用',     'excluded', 5),
  ('028', 'マイナンバー管理料金', 'excluded', 6),
  ('036', 'スポット手続',         'service',  7),
  ('056', '賞与計算',             'service',  8),
  ('060', '諸費用',               'excluded', 9),
  ('061', '給与支払報告書',       'service', 10),
  ('062', '算定基礎届',           'service', 11),
  ('063', '労働保険年度更新',     'service', 12),
  ('064', '住民税変更',           'service', 13),
  ('065', '年末調整',             'service', 14),
  ('080', '消費税',               'tax',     15)
ON DUPLICATE KEY UPDATE name = VALUES(name), allocationType = VALUES(allocationType), sortOrder = VALUES(sortOrder);

-- 工程振分率（%）。役務は合計100、配賦対象外/税は 0/0。
INSERT INTO jo_task_phases (taskCode, phaseCode, phaseName, ratio, sortOrder) VALUES
  ('001', 'PRE', 'Prepare', 100, 1), ('001', 'REV', 'Review',   0, 2),
  ('002', 'PRE', 'Prepare', 100, 1), ('002', 'REV', 'Review',   0, 2),
  ('003', 'PRE', 'Prepare',  70, 1), ('003', 'REV', 'Review',  30, 2),
  ('026', 'PRE', 'Prepare',  70, 1), ('026', 'REV', 'Review',  30, 2),
  ('027', 'PRE', 'Prepare',   0, 1), ('027', 'REV', 'Review',   0, 2),
  ('028', 'PRE', 'Prepare',   0, 1), ('028', 'REV', 'Review',   0, 2),
  ('036', 'PRE', 'Prepare', 100, 1), ('036', 'REV', 'Review',   0, 2),
  ('056', 'PRE', 'Prepare',  70, 1), ('056', 'REV', 'Review',  30, 2),
  ('060', 'PRE', 'Prepare',   0, 1), ('060', 'REV', 'Review',   0, 2),
  ('061', 'PRE', 'Prepare',  70, 1), ('061', 'REV', 'Review',  30, 2),
  ('062', 'PRE', 'Prepare',  70, 1), ('062', 'REV', 'Review',  30, 2),
  ('063', 'PRE', 'Prepare',  70, 1), ('063', 'REV', 'Review',  30, 2),
  ('064', 'PRE', 'Prepare',  70, 1), ('064', 'REV', 'Review',  30, 2),
  ('065', 'PRE', 'Prepare',  70, 1), ('065', 'REV', 'Review',  30, 2),
  ('080', 'PRE', 'Prepare',   0, 1), ('080', 'REV', 'Review',   0, 2)
ON DUPLICATE KEY UPDATE phaseName = VALUES(phaseName), ratio = VALUES(ratio), sortOrder = VALUES(sortOrder);

-- 設定：作業→請求オフセット（0=当月請求）。人事オフィスは基本0。
INSERT INTO jo_app_settings (settingKey, settingValue) VALUES
  ('billingOffset', '0')
ON DUPLICATE KEY UPDATE settingValue = VALUES(settingValue);

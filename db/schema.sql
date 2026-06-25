-- =====================================================================
-- J-Office 統合スキーマ (Insight + Invoice 共有・単一DB)
-- 対象DB : 2vt7g_joffice_pro  (お名前.com ステージング / 本番=X-Server)
-- DB     : MySQL 5.7 / InnoDB / utf8mb4 / utf8mb4_unicode_ci
-- 命名   : テーブル=jo_ 接頭辞(小文字) / 列=既存JSONキーに合わせ camelCase
-- 規約   : コード列=VARCHAR(前ゼロ保持) / 金額=DECIMAL(円・整数) / 月=CHAR(7)'YYYY-MM'
-- 由来   : design.md 第4章(9シート)+案2新シート3 / production-auth-db-memo.md(users・RBAC)
--          + 請求書発行(jo_invoices/jo_invoice_lines ※暫定・機能設計確定で精緻化)
-- 注意   : MySQL 5.7 前提。ウィンドウ関数/CTE/JSON_TABLE 等 8.0 専用機能は使わない。
--          集計・配賦は PHP 側(allocation.js 移植)で実施しビューに寄せない。
-- 更新   : 2026-06-25 初版
-- =====================================================================
SET NAMES utf8mb4;

-- 開発・検証での再適用用(本番初回適用時は不要)
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS
  jo_invoice_lines, jo_invoices, jo_billings, jo_worklogs, jo_users,
  jo_staff_targets, jo_customer_staff, jo_task_phases, jo_app_settings,
  jo_task_types, jo_customers, jo_staff;
SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- マスタ
-- =====================================================================

CREATE TABLE jo_staff (
  code      VARCHAR(20)  NOT NULL,            -- 社員番号 S001
  name      VARCHAR(100) NOT NULL,
  sortOrder INT NOT NULL DEFAULT 0,
  isActive  TINYINT(1) NOT NULL DEFAULT 1,
  updatedAt DATETIME NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE jo_customers (
  code          VARCHAR(20)  NOT NULL,        -- 関与先コード 0001
  name          VARCHAR(200) NOT NULL,
  paymentMethod ENUM('transfer','invoice') NULL,  -- 口座振替/請求書払い(二重計上防止)
  honorific     VARCHAR(10)  NOT NULL DEFAULT '御中',
  postalCode    VARCHAR(10)  NULL,            -- 請求書宛名用(任意)
  address1      VARCHAR(200) NULL,
  address2      VARCHAR(200) NULL,
  contactName   VARCHAR(100) NULL,
  sortOrder     INT NOT NULL DEFAULT 0,
  isActive      TINYINT(1) NOT NULL DEFAULT 1,
  updatedAt     DATETIME NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE jo_task_types (                  -- 業務区分
  code           VARCHAR(10)  NOT NULL,       -- 業務コード 026
  name           VARCHAR(100) NOT NULL,
  allocationType ENUM('service','excluded','tax') NOT NULL,  -- 役務/配賦対象外/税
  sortOrder      INT NOT NULL DEFAULT 0,
  updatedAt      DATETIME NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE jo_task_phases (                 -- 工程(Prepare/Review)
  id        BIGINT NOT NULL AUTO_INCREMENT,
  taskCode  VARCHAR(10) NOT NULL,
  phaseCode VARCHAR(10) NOT NULL,             -- PRE/REV
  phaseName VARCHAR(50) NULL,
  ratio     DECIMAL(5,2) NOT NULL DEFAULT 0,  -- %(役務は合計100)
  sortOrder INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_task_phase (taskCode, phaseCode),
  CONSTRAINT fk_phase_task FOREIGN KEY (taskCode) REFERENCES jo_task_types(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE jo_customer_staff (              -- 顧客担当・時系列(有効開始月方式)
  id            BIGINT NOT NULL AUTO_INCREMENT,
  customerCode  VARCHAR(20) NOT NULL,
  role          VARCHAR(10) NOT NULL,         -- =工程コード PRE/REV
  staffCode     VARCHAR(20) NULL,             -- 空=担当解除(tombstone)
  effectiveFrom CHAR(7) NOT NULL DEFAULT '',  -- 'YYYY-MM' 空=初期から(baseline)
  sortOrder     INT NOT NULL DEFAULT 0,
  updatedAt     DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cust_role_from (customerCode, role, effectiveFrom),
  KEY idx_cs_customer (customerCode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE jo_staff_targets (               -- 売上目標(スタッフ×月)
  targetMonth  CHAR(7) NOT NULL,
  staffCode    VARCHAR(20) NOT NULL,
  targetAmount DECIMAL(13,0) NOT NULL DEFAULT 0,
  updatedAt    DATETIME NULL,
  PRIMARY KEY (targetMonth, staffCode),
  CONSTRAINT fk_target_staff FOREIGN KEY (staffCode) REFERENCES jo_staff(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE jo_app_settings (                -- 設定(作業→請求オフセット 等)
  settingKey   VARCHAR(64) NOT NULL,
  settingValue VARCHAR(255) NULL,
  updatedAt    DATETIME NULL,
  PRIMARY KEY (settingKey)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- トランザクション
-- =====================================================================

CREATE TABLE jo_worklogs (
  id           VARCHAR(40) NOT NULL,          -- 既存決定論IDを維持
  `date`       DATE NOT NULL,                 -- 作業日
  staffCode    VARCHAR(20) NOT NULL,
  customerCode VARCHAR(20) NULL,              -- 空=社内/非生産
  taskCode     VARCHAR(10) NULL,              -- 業務コード
  phaseCode    VARCHAR(10) NULL,              -- PRE/REV
  taskType     VARCHAR(100) NULL,             -- 社内分類(カタログ外の社内工数表示用)
  hours        DECIMAL(5,2) NOT NULL DEFAULT 0,
  memo         TEXT NULL,
  updatedAt    DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_wl_date (`date`),
  KEY idx_wl_cust (customerCode),
  KEY idx_wl_staff (staffCode),
  KEY idx_wl_task (taskCode),
  KEY idx_wl_month_staff (`date`, staffCode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- 氏名(staff/customer)は保存せず API出力時に jo_staff/jo_customers を JOIN 付与

CREATE TABLE jo_billings (                    -- 請求(集計用の射影: CSV/請求書発行/手入力)
  invoiceId       VARCHAR(60) NOT NULL,       -- b_{月}_{顧客}_{内訳} / inv_{番号}_{内訳}
  billingMonth    CHAR(7) NOT NULL,
  customerCode    VARCHAR(20) NOT NULL,       -- ソフト参照(未登録は警告・拒否しない)
  customer        VARCHAR(200) NULL,          -- snapshot名(未登録顧客の保持用)
  invoiceItemCode VARCHAR(10) NULL,           -- 業務コード(恒等マッチング; 080=税)
  invoiceItem     VARCHAR(100) NULL,          -- 内訳表示名(snapshot)
  paymentMethod   VARCHAR(20) NULL,           -- 口座振替/請求書払い
  source          ENUM('csv','invoice','manual') NOT NULL DEFAULT 'manual',  -- 由来
  netAmount       DECIMAL(13,0) NOT NULL DEFAULT 0,  -- 税抜(080行は税額)
  taxAmount       DECIMAL(13,0) NOT NULL DEFAULT 0,
  grossAmount     DECIMAL(13,0) NOT NULL DEFAULT 0,
  issuedDate      DATE NULL,
  paymentDueDate  DATE NULL,
  paymentStatus   VARCHAR(20) NULL,
  transferDate    DATE NULL,                  -- 振替日(CSV)
  memo            TEXT NULL,
  updatedAt       DATETIME NULL,
  PRIMARY KEY (invoiceId),
  KEY idx_bl_month (billingMonth),
  KEY idx_bl_cust (customerCode),
  KEY idx_bl_month_cust (billingMonth, customerCode),
  KEY idx_bl_itemcode (invoiceItemCode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 請求書発行(原本)  ※暫定: 採番ルール・適格登録番号・宛名/住所は機能設計で確定
-- =====================================================================

CREATE TABLE jo_invoices (                    -- 請求書ヘッダ
  invoiceNo       VARCHAR(30) NOT NULL,       -- 採番(ルール要確定)
  customerCode    VARCHAR(20) NOT NULL,
  billingMonth    CHAR(7) NOT NULL,           -- 請求対象月
  issueDate       DATE NOT NULL,
  dueDate         DATE NULL,
  billToName      VARCHAR(200) NOT NULL,      -- 宛名 snapshot
  billToHonorific VARCHAR(10) NOT NULL DEFAULT '御中',
  billToAddress   VARCHAR(255) NULL,
  subtotal        DECIMAL(13,0) NOT NULL DEFAULT 0,  -- 税抜計
  tax             DECIMAL(13,0) NOT NULL DEFAULT 0,  -- 消費税
  total           DECIMAL(13,0) NOT NULL DEFAULT 0,  -- 税込計
  issuerRegNo     VARCHAR(20) NULL,           -- 適格 登録番号 T+13桁(自社)
  status          ENUM('draft','issued','sent','paid','void') NOT NULL DEFAULT 'draft',
  pdfPath         VARCHAR(255) NULL,
  memo            TEXT NULL,
  createdBy       VARCHAR(50) NULL,
  createdAt       DATETIME NULL,
  updatedAt       DATETIME NULL,
  PRIMARY KEY (invoiceNo),
  KEY idx_inv_cust (customerCode),
  KEY idx_inv_month (billingMonth),
  KEY idx_inv_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE jo_invoice_lines (               -- 請求書明細
  id        BIGINT NOT NULL AUTO_INCREMENT,
  invoiceNo VARCHAR(30) NOT NULL,
  lineNo    INT NOT NULL,
  taskCode  VARCHAR(10) NULL,                 -- 業務コード(恒等マッチング)
  itemName  VARCHAR(120) NOT NULL,
  quantity  DECIMAL(10,2) NOT NULL DEFAULT 1,
  unitPrice DECIMAL(13,2) NOT NULL DEFAULT 0,
  amount    DECIMAL(13,0) NOT NULL DEFAULT 0, -- 税抜金額
  taxRate   DECIMAL(4,1) NOT NULL DEFAULT 10.0,  -- %(将来の複数税率に備える)
  sortOrder INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inv_line (invoiceNo, lineNo),
  CONSTRAINT fk_line_inv FOREIGN KEY (invoiceNo) REFERENCES jo_invoices(invoiceNo) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 認証 / 権限 (RBAC: admin/manager/staff)
-- =====================================================================

CREATE TABLE jo_users (
  id                 BIGINT NOT NULL AUTO_INCREMENT,
  loginId            VARCHAR(50) NOT NULL,     -- 社員番号(ログインID)
  passwordHash       VARCHAR(255) NOT NULL,    -- bcrypt(password_hash)
  role               ENUM('admin','manager','staff') NOT NULL DEFAULT 'staff',
  staffCode          VARCHAR(20) NULL,         -- jo_staff リンク(工数所有者)
  displayName        VARCHAR(100) NULL,
  isActive           TINYINT(1) NOT NULL DEFAULT 1,
  mustChangePassword TINYINT(1) NOT NULL DEFAULT 1,
  failedAttempts     INT NOT NULL DEFAULT 0,
  lockedUntil        DATETIME NULL,
  lastLoginAt        DATETIME NULL,
  createdAt          DATETIME NULL,
  updatedAt          DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_login (loginId),
  KEY idx_user_staff (staffCode),
  CONSTRAINT fk_user_staff FOREIGN KEY (staffCode) REFERENCES jo_staff(code) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 監査ログ jo_audit_log は production-auth-db-memo §3 の任意強化として後追加予定。
-- =====================================================================
-- EOF
-- =====================================================================

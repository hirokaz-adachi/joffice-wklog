# JOfficeInvoice 機能設計（請求書発行・billing連携）

作成: 2026-06-25 ／ HLS（adachi）
位置づけ: 自前発行（請求書払い）分の請求書を作成・PDF発行し、確定時に J-Office Insight の請求テーブル（`jo_billings`）へ射影する **請求書発行アプリ（JOfficeInvoice）** の機能設計正本。新基盤（PHP＋MySQL／joffice-pro）上にネイティブ実装する。
関連: [design.md](./design.md)（Insight 設計正本・第8章 配賦）／[migration-plan-php-mysql-2026-06-22.md](./migration-plan-php-mysql-2026-06-22.md)（移行戦略・環境）／[production-auth-db-memo.md](./production-auth-db-memo.md)（認証・RBAC）／[../db/schema.sql](../db/schema.sql)（DDL正本）

---

## 1. 目的・スコープ

- 口座振替（かつ・かいしゅう）はCSV取込で `jo_billings` に入る。**請求書払いの顧客分**は取込元が無いため、自前で**請求書を発行し同じ `jo_billings` へ集約**する。
- Insight と **同一DB `2vt7g_joffice_pro`・顧客マスタ・業務区分マスタを共有**。確定発行分は CSV分と**区別なく**生産性指標に乗り、`allocation.js`（配賦エンジン）は**無改修**。
- 依存：PHP API＋認証の足場が前提。**ビルド順は「PHP基盤＋認証 → 本機能」**。本設計は先行確定。

## 2. データモデル

`jo_invoices`（ヘッダ）／`jo_invoice_lines`（明細）を正式採用。採番のため `jo_invoice_seq` を追加し、ヘッダに `dueRule` を追加（DDLは [../db/schema.sql](../db/schema.sql) が正本）。

- `jo_invoices`：`invoiceNo`(PK・採番)／`customerCode`／`billingMonth`(請求対象月)／`issueDate`／`dueDate`／**`dueRule`**(支払期限の算出方式)／`billToName`/`billToHonorific`/`billToAddress`(宛名スナップショット)／**`subject`(件名・請求書に表示／2026-06-29追加)**／`subtotal`(税抜計)/`tax`(消費税)/`total`(税込計)／`issuerRegNo`(適格登録番号スナップショット)／`status`／`pdfPath`／**`remarks`(備考・請求書PDFに表示／2026-06-29追加)**／**`memo`(社内メモ・PDF非表示)**／`createdBy`(=**発行者**＝確定発行を行ったユーザの loginId・発行日時は `createdAt`)。
- `jo_invoice_lines`：`invoiceNo`／`lineNo`／`taskCode`(業務コード=恒等マッチング)／`itemName`／`quantity`／`unitPrice`／`amount`(税抜)／`taxRate`(%)／`sortOrder`。
- `jo_invoice_seq`：`periodKey`(CHAR6 'YYYYMM')／`lastSeq`。発行時に行ロックで一意採番。

発行者情報・既定値は `jo_app_settings`（キーバリュー）：

| settingKey | 用途 |
|---|---|
| `issuer.name` | 自社名（人事オフィス） |
| `issuer.regNo` | 適格登録番号 T+13桁（**未確認→後入力**） |
| `issuer.address` / `issuer.tel` | 発行者 住所・電話 |
| `issuer.bank` | 振込先（銀行・支店・種別・番号・名義） |
| `issuer.sealImage` | 角印（社判）画像のパス（pro/ からの相対・既定 `assets/issuer-seal.png`／2026-06-29追加） |
| `invoice.dueRuleDefault` | 支払期限の既定方式（請求ごとに変更可） |
| `invoice.taxRoundMode` | 消費税端数処理（`floor`＝切り捨て・確定） |

> `issuerRegNo` は発行時に設定値を**スナップショット**（後で設定が変わっても発行済みは当時の番号を保持）。

## 3. 採番ルール（年月＋連番）

- 形式 **`YYYYMM-NNN`**（例 `202604-001`）。`YYYYMM`＝**請求対象月（billingMonth）**、`NNN`＝その月の通し連番（3桁ゼロ詰め）。
- 発行時に `jo_invoice_seq` の当月行を **`SELECT … FOR UPDATE` で行ロック → +1**（無ければ insert）。**採番・INSERT・射影を1トランザクションで原子的コミット**（GAS の LockService 相当を MySQL トランザクションで実現）。

## 4. 消費税・適格請求書様式

- **適格前提で様式を作る**（登録番号は設定後入力。未確認＝櫻井所長に要確認）。PDF必須記載：発行者名称・**登録番号 T+13桁**・取引年月日・取引内容・**税率ごとに区分した対価合計と消費税額**・交付先名称。
- 当面 **10%単一税率**。`taxRate` で将来の複数税率（軽減税率）に拡張可。
- 税額＝**税率ごとに対価合計を出し、1請求書あたり1回 端数処理＝切り捨て（確定）**。`subtotal`=税抜計、`tax`=消費税、`total`=税込。

## 5. 状態遷移とワークフロー

`status`: `draft → issued →（sent）→（paid）／ void`

- **draft（下書き）**：自由編集。採番・射影なし。
- **issued（確定発行）**：採番確定 → PDF生成 → `jo_billings` 射影 → 内容ロック。
- **void（取消）**：発行済みの訂正は「**取消 → 再発行**」。void で射影 `jo_billings` 行を削除（決定論IDで特定）し、請求書は void 保持。**法定保存のため物理削除しない（確定）**。
- `sent`（送付）・`paid`（入金）は**後フェーズ**（`paymentStatus` 枠あり）。

## 6. 支払期限（dueRule・請求ごとに選択）

3方式を**請求書ごとに選択**でき、算出された `dueDate` は**編集可**。既定は `invoice.dueRuleDefault`。

| dueRule | 内容 |
|---|---|
| `net30` | 発行日 ＋ 30日 |
| `issueNextMonthEnd` | 発行月の翌月末 |
| `billingNextMonthEnd` | 請求対象月（billingMonth）の翌月末（月末締め翌月末） |

## 7. `jo_billings` への射影規約（連携の核心）

確定発行時、明細を CSV取込と同形式で射影：

- **役務／配賦対象外 行**（業務コードごと）：
  - `invoiceId = inv_{invoiceNo}_{taskCode}`（決定論・再発行upsert／例 `inv_202604-001_026`）
  - `billingMonth`=請求対象月、`customerCode`/`customer`、`invoiceItemCode`=`taskCode`、`invoiceItem`=品名
  - `paymentMethod='請求書払い'`、`source='invoice'`
  - `netAmount`=税抜金額、`issuedDate`/`paymentDueDate`、`transferDate=NULL`
- **消費税 行（080・1本）**：`invoiceId = inv_{invoiceNo}_080`、`invoiceItemCode='080'`、`netAmount`=消費税額（`taxAmount=0`）。CSVの080独立行と同じ扱い → `allocation.js` が税として集計（税抜売上に含めない）。

→ 口座振替（CSV）と請求書払い（自前発行）が**区別なく同じ指標に乗り**、配賦ロジックは無改修。void時は同 `invoiceId` 接頭辞の行を削除。

## 8. 二重計上防止

- `jo_customers.paymentMethod`（`transfer`／`invoice`）で請求経路を明示。
- **請求書作成は `paymentMethod='invoice'` の顧客が基本**（`transfer` 顧客選択時は警告）。
- **CSV取込は逆に `paymentMethod='invoice'` の顧客が現れたら警告**（口座振替CSVに本来出ないはず）。同一 `billingMonth×顧客×業務コード` の重複も取込プレビューで検知。

## 9. 画面（新規・PHP＋fetch）

- **請求書一覧**（`invoice-list`）：請求月／顧客／ステータスで絞込。**発行者列**（確定処理ユーザの表示名・下書きは「—」／2026-06-29）。操作は状態別＝下書き:編集/確定発行/削除、発行済:**表示**/印刷PDF/複製/取消、取消:**表示**/再作成。
- **請求書編集**（`invoice-edit`）：顧客選択（共有マスタ）→**宛名・敬称・宛先住所を顧客マスタから自動プリセット**（編集可・スナップショット。住所・敬称・請求区分は顧客マスタの登録値由来。`paymentMethod='transfer'` 顧客は二重計上警告）→**件名**→明細行（業務コードを `jo_task_types` から選択＋品名・数量・単価→金額自動）→税自動計算→支払期限方式選択→**備考（PDF表示）／社内メモ（PDF非表示）**→**下書き保存／PDFプレビュー／確定発行**。新規時は**請求対象月を当月でプリセット**（2026-06-29）。**発行済み/取消は同画面を閲覧専用で開く**（全入力 disabled・編集系ボタン非表示・上部に発行者/発行日時バナー・「印刷/PDFを開く」ボタン／2026-06-29）。
- **PDFプレビュー**（`invoice-edit` のボタン）：現在の内容を下書き保存し、別タブで印刷ビューを開く。未採番の下書きは請求番号を「（下書き・未採番）」と表示。
- **印刷ビュー**（`invoice-print`）：適格様式のレイアウト。御請求書（グレー帯）／請求日・請求番号／宛名+敬称・件名・挨拶文／発行者名・登録番号・住所+**角印**／ご請求金額（税込）枠／明細4列（品名/単価税抜/数量/金額税抜・空行で高さ確保）／税サマリ（税率ごと税抜・消費税＋税込合計）と**支払期限・振込先を左右併置**／備考枠／適格請求書フッター。印刷CSSで**A4 1ページに収める**（`@page` 余白・`min-height` 解除・右罫線見切れ防止）。
- メニュー（index）に「請求書発行」を追加。**前月複製**で定常請求を効率化（簡易の定期請求テンプレ代替）。

## 10. API（PHP・新規）

`listInvoices` / `getInvoice` / `saveInvoiceDraft` / `issueInvoice`（採番＋PDF＋射影・原子的）／ `voidInvoice`（射影削除＋void）／ `getInvoicePdf` / 発行者設定の get・save。顧客・業務区分は既存 `bootstrap` を再利用。認可は admin/manager（発行は重い書込のため staff 不可を想定）。

## 11. PDF生成

- **現状（2026-06-29）：印刷用HTMLビュー（`invoice-print`）＋ブラウザ印刷でPDF保存**。レイアウトはサンプル（invox生成の適格請求書）準拠で確定済み（§9・角印/件名/備考/4列明細/支払・税サマリ併置/A4 1ページ）。**制約**：ブラウザが自動付与するヘッダ/フッタ（日付・URL・ページ番号）はCSSで消せないため、当面は印刷ダイアログで「ヘッダーとフッター」をオフにして運用。
- **本命（未実装）：PHPライブラリ（mPDF）でサーバ生成**（composer で導入・お名前/X-Server 両対応）。日本語フォント埋め込み、上記レイアウトを mPDF互換CSS（flexは不可→テーブル化）へ移植。発行時/ダウンロード時に生成し `pdfPath` 保持。**保存先は公開フォルダ外＋認証経由ダウンロード**（production-auth-db-memo §7）。これによりブラウザのヘッダ/フッタ問題と改ページを恒久解決。

## 12. MVPスコープ

- **第1弾**：作成 → 確定発行（採番・PDF・射影）→ 一覧・複製・取消。発行者設定（登録番号は後入力）。
- **後フェーズ**：入金管理（`paid`・督促）、複数税率・軽減税率、定期請求の本格テンプレート、送付（`sent`）導線。

## 13. 未確定・要確認

- **適格請求書発行事業者か／登録番号 T+13桁**（櫻井所長に要確認。未確認のため様式は適格前提で枠だけ・`issuer.regNo` で後入力）。
- **発行者情報の実値**（自社名・住所・電話・振込先口座）。設定投入時に確定。
- **X-Server / お名前での PDFライブラリ（mPDF）導入確認**（composer・日本語フォント同梱可否）。ローカルComposerは導入済み。
- ~~請求書様式（レイアウト）の確定~~ → **2026-06-29 確定済み**（サンプル準拠・角印/件名/備考/4列明細/A4 1ページ・§9）。残るはmPDF移植時の体裁微調整のみ。

## 14. 更新履歴

### 2026-06-29（レイアウト刷新・項目拡充・閲覧/プレビュー）
- **件名 `subject`／備考 `remarks` 新設**（`jo_invoices`・migration 適用済）。`memo` は社内メモ（PDF非表示）に確定し、`remarks` を請求書PDFの備考欄に表示（従来 memo を流用していた不整合を是正）。
- **印刷ビュー全面刷新**（`invoice-print`）：サンプル（invox 適格請求書）準拠。御請求書帯・請求日/番号・宛名+敬称・件名・挨拶文・発行者+**角印**（`issuer.sealImage`・既定 `pro/assets/issuer-seal.png`）・ご請求金額枠・**4列明細**（品名/単価/数量/金額）+空行・税サマリと**支払期限/振込先を左右併置**・備考枠。日付は和式。invox宣伝フッター無し。印刷CSSで **A4 1ページ**（`@page` 余白・`min-height`解除・右罫線見切れ防止）。**ブラウザ自動付与のヘッダ/フッタはHTML印刷では消せず、当面は印刷ダイアログでオフ運用**（恒久解決は mPDF・§11）。
- **発行者表示**：一覧に発行者列、発行済み/取消の閲覧専用画面に発行者（`createdBy`＋`jo_users.displayName`）と発行日時。`jo_get_invoice`/`jo_list_invoices` で `jo_users` を結合。発行者は社内情報のため**PDFには非表示**。
- **発行済み/取消の閲覧専用表示**：一覧の「表示」から `invoice-edit` を閲覧専用で開く（全入力 disabled・編集系ボタン非表示・「印刷/PDFを開く」）。
- **PDFプレビュー**ボタン（`invoice-edit`）：現内容を下書き保存→別タブで印刷ビュー（下書きは「下書き・未採番」表示）。
- **入力補助**：新規時に請求対象月を当月プリセット。件名欄ラベルの不適切な例示を削除。
- **顧客マスタ連携**：`jo_customers` の住所（`postalCode`/`address1`/`address2`）・`paymentMethod`・`honorific`・`contactName` を顧客マスタ編集UIで登録可能化（[design.md](./design.md) 参照）。`invoice-edit` は顧客選択時に宛先住所・敬称既定・二重計上警告をこれらからプリセット（未設定ならプリセットなし）。**いずれも既存カラムで DB変更なし**。

### 2026-06-26（MVP第1弾 実装）
- `pro/lib/invoices.php`＋API（listInvoices/getInvoice/saveInvoiceDraft/issueInvoice/voidInvoice/duplicateInvoice/deleteInvoiceDraft・admin専用・更新系CSRF）を実装。画面 invoice-list/edit/print/settings ＋ index 導線。
- **下書きモデル**：採番はスキーマ上 invoiceNo がPKのため、下書きは暫定 `draft_{uniqid}` で保持し、**確定発行時に実番号 `YYYYMM-NNN` の新規行を作成→明細コピー→射影→下書き行を削除**（PK変更・FK ON UPDATE を回避）。採番は `jo_invoice_seq` を `INSERT IGNORE`＋`SELECT … FOR UPDATE`＋`UPDATE` で原子的。
- **射影**：§7どおり `inv_{invoiceNo}_{taskCode}`（業務コードごとに集約）＋ 税 `inv_{invoiceNo}_080`（netAmount=税額・taxAmount=0）・`source='invoice'`・`paymentMethod='請求書払い'`。取消は同接頭辞を削除し status=void 保持。
- **PDF**：当面は**印刷用HTMLビュー**（invoice-print.html・適格様式：発行者名/登録番号T+13桁/取引年月日/取引内容/税率ごと対価合計と消費税額/交付先名称）。mPDFサーバ生成は後続（ローカルComposer導入済み＝[[joffice-local-php-env]]）。
- **発行者情報**：登録番号など未確定は暫定値で運用可（発行時に `issuerRegNo` スナップショット）。
- **検証**：実機スモークテスト（採番・税切捨・射影3行・source=invoice・採番増分・取消で射影削除＆void保持・後始末）**全19項目PASS**。
- **残**：請求書払いデモデータ投入（一部顧客を invoice 化）／mPDFサーバ生成／入金管理・送付。RBACは admin専用で確定（manager閲覧は今回見送り）。

### 2026-06-25（新規作成）
- JOfficeInvoice 機能設計を新設。確定事項：採番＝年月＋連番（`YYYYMM-NNN`・請求対象月基準・行ロック原子採番）、適格＝前提で枠だけ（登録番号は設定後入力）、PDF＝PHPライブラリ（mPDF）サーバ生成、消費税端数＝切り捨て、支払期限＝3方式を請求ごとに選択（`net30`／`issueNextMonthEnd`／`billingNextMonthEnd`・算出後編集可）、発行済み訂正＝取消→再発行（物理削除しない）。`jo_billings` への射影規約（役務行＋080税行・`source='invoice'`・決定論ID）で配賦エンジン無改修。二重計上防止に `customers.paymentMethod`／`billings.source`。スキーマに `jo_invoice_seq` 追加・`jo_invoices.dueRule` 追加。

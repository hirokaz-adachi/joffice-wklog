# 本番移行設計メモ（PHP＋MySQL 化・環境戦略）

作成: 2026-06-22 ／ 更新: 2026-06-25 ／ HLS（adachi）
位置づけ: デモ（静的フロント＋GAS＋スプレッドシート）から本番（PHP＋MySQL）へ移行する際の、**移行の実行戦略・環境構成・フォーク方針**をまとめたメモ。認証・RBAC・スキーマの方針は [production-auth-db-memo.md](./production-auth-db-memo.md) が正本で、本メモはそれを前提に「いつ・どこで・どう移すか」を扱う。確定仕様ではなく着手前のたたき台。
関連: [design.md](./design.md)（設計の正本）／[production-auth-db-memo.md](./production-auth-db-memo.md)（認証・DB・RBAC）／[handoff-code-2026-06-22.md](./handoff-code-2026-06-22.md)（実装ハンドオフ）／[handoff-2026-06-22.md](./handoff-2026-06-22.md)（事業フェーズ）

---

## 0. 結論（先に要点）

1. **段取り**: まず現デモ（GAS構成）で**詳細分析画面（工数フェーズ）まで実装して凍結** → その後フォークして PHP＋MySQL 化に着手する。フロントは大部分流用でき、差し替えは `backend.js` の通信層（JSONP→fetch）が中心。
2. **環境**: 現デモ `tools.h-linksystems.com/joffice/`（HLS契約・お名前.com）は**お客様公開のデモのまま凍結**。本番相当は同サーバの `tools.h-linksystems.com/joffice-pro/` に**ステージング（検証環境）**として構築する。**真の本番は先方契約の X-Server**。`/joffice-pro/` は本番そのものではなく「X-Server へ載せる前の検証環境」と位置づける。
3. **バージョン決め打ち（最重要・2026-06-25 確定）**: 開発（お名前.com）と本番（X-Server）の DB が**ともに MySQL 5.7 系で一致**することを実機・カタログで確認（お名前＝**MySQL 5.7.44** 実測／X-Server＝MySQL 5.7.x）。よって **DB＝MySQL 5.7 決め打ち**、**PHP＝8.1 固定**で確定。MariaDB は使わない（両環境とも純正 MySQL に揃える）。
4. **実データの扱い**: HLS自社サーバ（お名前.com）に**先方の実顧客データ（個人情報・請求額）を置かない**。ステージングは匿名化サンプル／デモデータで検証する。
5. **移行の契機＝請求書発行機能（2026-06-25）**: 自前発行の請求書払い分を取り込む **請求書発行アプリ（JOfficeInvoice）** の新設が移行の引き金。Invoice は Insight と**顧客マスタ・請求テーブルを共有**するため、**両者を同一 DB（単一データストア）に同居**させる。請求書という法定保存・対外発行・金額正確性が要る機能を旧基盤（GAS）に作って作り直すのを避け、**全面移行 → 新基盤で請求書をネイティブ実装**する順序とする（詳細な機能設計は別途）。

---

## 1. 環境マップ

| 環境 | URL / 基盤 | 契約 | 構成 | 用途 | 状態 |
|---|---|---|---|---|---|
| デモ | `tools.h-linksystems.com/joffice/`（お名前.com） | HLS | 静的＋GAS＋スプレッドシート（JSONP） | 商談用・お客様公開 | 稼働中・**凍結予定** |
| ステージング | `tools.h-linksystems.com/joffice-pro/`（お名前.com） | HLS | 静的＋**PHP＋MySQL**（同一オリジン fetch） | 本番相当の検証 | **新規構築** |
| 本番 | X-Server（プラン未確定） | **人事オフィス** | 静的＋PHP＋MySQL | 実運用 | 未着手・契約確認待ち |

- デモとステージングは同じお名前.comサーバ上の**別ディレクトリ**。デモ（GAS）はそのまま、`/joffice-pro/` 配下にPHPアプリを新設する。
- ステージング→本番は基盤が違う（お名前.com→X-Server）ため、**バージョン差を吸収しておくことがステージングの価値**。揃っていないと「動いたのに本番で動かない」偽の安心になる。
- **2026-06-25: ステージング用DBをお名前.com上に作成済み**。DB名 `2vt7g_joffice_pro`（お名前のアカウント接頭辞 `2vt7g_` が自動付与・指定値は `joffice_pro`）、サーバ接続照合 `utf8mb4_unicode_ci`、phpMyAdmin 5.2.1。**Insight＋Invoice 共有の単一DB**。DBユーザーは最小権限の専用ユーザー（`joffice_app` 想定・この1DBのみ権限）、テーブルは `jo_` 接頭辞で統一。接続情報は**公開フォルダ外**に保存（§5・production-auth-db-memo.md 第7章）。

---

## 2. 環境スペック調査結果（2026-06-25 更新）

> 2025-05-20 のプラン改定で **お名前.com「RSプラン」は「ベーシックプラン」へリニューアル**（HLSの現契約＝旧RSは継続利用可・実体スペックはほぼ同等）。X-Server は **DB数無制限化／スタンダードが NVMe SSD 500GB／自動バックアップ標準** に更新。

| 項目 | お名前.com RS／ベーシック（HLS・開発/検証） | X-Server スタンダード（本番候補） |
|---|---|---|
| PHP | 7.0〜**8.4** 選択可（LSAPI・管理画面で切替） | 7.x〜8.x 選択可（切替可・8.1でWP動作確認） |
| DB エンジン/版 | **MySQL 5.7.44**（実測・Source distribution＝純正MySQL） | **MySQL 5.7.x ／ MariaDB 10.5.x ／ 10.11.x** |
| DB 作成数 | 無制限 | 無制限 |
| 1DBあたり容量 | 5GB | 5GB |
| 文字コード/照合 | utf8mb4／既定 `utf8mb4_unicode_ci` | utf8mb4／utf8／EUC-JP／Shift-JIS／Binary |
| SSH | 対応 | 対応 |
| 無料独自SSL | 対応（Let's Encrypt・無制限） | 対応（Let's Encrypt・自動更新） |
| cron | 対応 | 対応 |
| .htaccess / mod_rewrite | 対応 | 対応 |
| phpMyAdmin | 標準（5.2.1） | 標準 |
| ディスク | 1TB SSD | NVMe SSD 500GB（メモリ8GB保証・転送量無制限） |
| 自動バックアップ | 14日間・自動 | 標準搭載（全プラン） |
| FTP/FTPS | 対応（`deploy.ps1` で運用中） | 対応 |

出典:
- お名前.com サーバースペック（ヘルプ）: https://help.onamae.com/answer/20165
- お名前.com RS／ベーシック完全ガイド: https://tools-online-system.com/onamae-server-rs-plan/
- エックスサーバー サーバー仕様一覧: https://www.xserver.ne.jp/manual/man_server_spec.php
- エックスサーバー データベース仕様一覧: https://www.xserver.ne.jp/manual/man_db_spec.php
- エックスサーバー 料金プラン比較: https://www.xserver.ne.jp/price/
- エックスサーバー プラン比較【2026年最新】: https://inno-mark.jp/e-engineer/xserver-rental/

**含意（共通最安定条件＝この値で組めばどちらでも動く）**:

| 構築条件 | 決め打ち値 | 理由 |
|---|---|---|
| PHP | **8.1 固定** | 両環境で選択可・枯れたLTS級。最新追従より「本番に合わせる」を優先 |
| DB | **MySQL 5.7**（両環境一致・5.7.44実測） | floor を 5.7 にすれば両環境で確実に動く |
| 避けるSQL | ウィンドウ関数・CTE（`WITH`）・`JSON_TABLE`・`CHECK`強制・functional index（**8.0専用**） | 5.7に無い。使うと「お名前で動いてX-Serverで落ちる」事故 |
| 集計・配賦 | **PHP側に実装**（`allocation.js` 移植）。SQLは素直なCRUDに留める | 高度SQLを避けDBバージョン差の影響を最小化。指標定義は design.md 第5・8章が正本 |
| 文字コード/照合 | **utf8mb4 / utf8mb4_unicode_ci** で統一 | 文字化け防止（お名前の既定と一致） |
| コード列の型 | 顧客 `0001`・業務 `026` は **CHAR/VARCHAR**（INT禁止） | 前ゼロ落ち再発防止（GAS版で根治済みの教訓を移植） |

**その他の含意**:
- 両環境が純正 MySQL 5.7 で一致したため、MariaDB との関数・予約語・照合差は**考慮不要**になった（X-Server でも MySQL を選択する）。
- 両環境とも SSH＋composer・cron 対応のため、請求書 **PDF生成ライブラリ（mPDF/TCPDF 等）**と**定期処理（督促・取込）の cron** は問題なく載る。
- 本アプリ規模（顧問先約60社・スタッフ9名）は 1DB 5GB・スタンダード相当で過剰スペック。**X-Server の実プラン確認は移行のブロッカーではなく最終微調整に格下げ**。

---

## 3. アーキテクチャ移行の要点

詳細な認証・スキーマ・RBACは production-auth-db-memo.md を正本とする。本メモでは差分のみ。

- **通信層**: `backend.js` を JSONP（`<script>` 動的生成＋URLトークン）から、**同一オリジンの `fetch()`（PHPエンドポイント）**へ差し替える。同一オリジン化により httpOnly・Secure・SameSite な Cookie セッションが素直に使える（JSONP由来の制約が解消）。
- **フロント**: 既存 HTML/CSS/JS をほぼ流用。画面（index/worklog/staff/dashboard/master/targets/data-edit/analysis）は維持し、データ取得関数の実装だけ差し替える。`backend.js` のクライアント関数のシグネチャを保てば画面側の改修を最小化できる。
- **集計・配賦ロジック**: dashboard.js のクライアント集計（時間単価・達成率・工数按分・案2の主担当フォールバック）を、PHP（API層）へ移植。MySQL 5.7 ではウィンドウ関数・CTE が使えないため、ビューに寄せず**PHP側で集計**する。**指標定義は design.md 第5章、配賦は第6〜8章を正本**として一致させ、`allocation.js` の回帰テスト（`test-allocation.mjs`／`verify-demo.mjs`）と突き合わせる。
- **シート→テーブル**: production-auth-db-memo.md 第4章の対応表（worklogs/staff/customers/task_types/billings/staff_targets ＋ users）に従う。さらに案2の新シート3（task_phase_master＝工程／customer_staff_master＝顧客担当・時系列／app_settings＝設定）と、請求書発行の新テーブル（**jo_invoices**／**jo_invoice_lines**）を追加。**`item_master`（品目）は 2026-06-24 に撤去済みのため作らない**（恒等マッチングで業務区分マスタ task_types に一本化・design.md 第8-2）。全テーブル `jo_` 接頭辞・コード列は VARCHAR。**DDLの正本は [../db/schema.sql](../db/schema.sql)**（2026-06-25 初版・MySQL 5.7・列は既存JSONキーに合わせ camelCase・氏名は保存せずAPIでJOIN付与・`jo_invoices`/`jo_invoice_lines` は請求書機能設計が確定するまでの暫定）。
- **シークレット**: DB接続情報等は**公開フォルダ外**に置く（`config.js` のようなブラウザ配布ファイルに絶対入れない）。production-auth-db-memo.md 第7章の方針。

---

## 4. リポジトリ / フォーク戦略

現リポジトリ: `https://github.com/hirokaz-adachi/joffice-wklog`（branch `main`・デモ）。

**推奨: 別リポジトリへフォーク（完全分離）**。理由はアーキが GAS→PHP と根本的に変わり、デモの保守と本番開発を混在させると事故（誤デプロイ・設定取り違え）が増えるため。

| 案 | 内容 | 採否 |
|---|---|---|
| (a) 別リポジトリ（fork） | `joffice-wklog` をフォークし `joffice-pro` 新設。デモは現リポジトリで凍結保守 | **推奨** |
| (b) 同一リポジトリ＋ブランチ | `main`(デモ)／`pro`ブランチ | 次点（共有コード追従を重視する場合） |
| (c) モノレポ＋ディレクトリ分割 | `/demo` `/pro` | 共通アセット一元管理を重視する場合 |

- いずれでも、**詳細分析画面の完成コミットを「フォーク基点」**にする。基点を明確にしておくと、デモ側のバグ修正を本番側へ取り込む際の差分管理が楽になる。
- 秘匿ファイル（`config.js`／`scripts/deploy.config.ps1`／`gas/.clasp.json`／PHPのDB設定）は引き続き `.gitignore` 対象。サンプル（`*.sample.*`）のみコミット。

---

## 5. セキュリティ / データ取り扱い

- **開発中の覆い**: `/joffice-pro/` は推測しやすいURLのため、開発期間は**ディレクトリBASIC認証で覆う**（production-auth-db-memo.md 第7章の方針）。本番ではログイン認証に置き換える。
- **実顧客データを HLS サーバに置かない**: ステージング（お名前.com・HLS契約）に先方の実データ（顧客名・請求額・個人情報）を投入しない。検証は**匿名化サンプル or 現デモデータ**で行う。実データを使うPoCは先方環境側、または個人情報取り扱い合意を取得してから。
- **シークレットは公開フォルダ外**: DB接続情報・トークンは docroot 外。`.htaccess deny` より公開フォルダ外配置を優先。
- **認可はサーバ側API**: 画面の出し分けは補助。本当のガードは各PHP APIでロール（admin/manager/staff）に応じてSQLフィルタ（production-auth-db-memo.md 第3章・RBAC確定事項）。

---

## 6. 移行ステップ（概略）

1. **前提固定（確定済 2026-06-25）**: PHP＝8.1系 / DB＝MySQL 5.7（両環境一致・お名前 5.7.44 実測）に決め打ち。お名前.com側の検証環境もこのバージョンに合わせる。
2. **X-Server契約確認**: 先方プラン（スタンダード/プレミアム/ビジネス or 旧プラン、もしくは XServerビジネス）の PHP・MySQL・SSH・無料SSL・DB上限を確認。共通最安定条件で組むため影響は小だが、最終確定に用いる。
3. **フォーク**: 詳細分析画面完成コミットを基点に `joffice-pro` を作成（案(a)推奨）。
4. **検証環境構築**: `tools.h-linksystems.com/joffice-pro/` に PHP＋MySQL 環境を用意（BASIC認証で覆う）。DB `2vt7g_joffice_pro` にスキーマ作成（production-auth-db-memo.md 第4章＋案2新シート3＋請求書2テーブル＋ users＋インデックス・全 `jo_` 接頭辞）。
5. **API実装**: PHPで参照・更新・認証APIを実装。`backend.js` を fetch ベースに差し替え。集計・配賦ロジックを移植。
6. **認証・認可**: 全APIにセッション検証＋ロール別フィルタを適用。staff.html にログイン画面追加。
7. **検証**: 匿名化サンプルで4指標・配賦・RBACの妥当性を確認。
8. **本番展開**: X-Server へ配置（FTPSデプロイ運用を流用）。スキーマ作成→データ取込→動作確認→切替。

---

## 7. 未確定・要確認

解決済（2026-06-25）:
- ~~お名前.com（HLS）の MySQL 実バージョン~~ → **MySQL 5.7.44（純正・Source distribution）と実測確認**。X-Server の MySQL 5.7.x と一致。
- ~~DBエンジンの最終選択（MySQL か MariaDB か）~~ → **MySQL 5.7 に確定**（両環境一致・X-Server でも MySQL を選択）。
- ~~案2（売上配賦の精緻化）の決着~~ → **2026-06-23 実装・デプロイ済、業務区分カタログ 2026-06-24 確定**（design.md 第8章）。配賦は確定形を PHP へ一度で移植できる。

残（要確認）:
- **X-Server の契約形態**。共通最安定条件で組めば影響は小だが、DB上限・PHP上限・SSH可否・SSL仕様の最終確認は要（判明次第バージョン微調整）。
- **GAS版と本番の並行運用期間**（一気に切替か、段階移行か）。
- ~~**請求書発行（JOfficeInvoice）の機能設計**~~ → **設計済（2026-06-25・[invoice-feature-design.md](./invoice-feature-design.md)）**。残るは適格登録番号(T+13桁)の所長確認・発行者情報の実値・mPDF導入確認・様式レイアウト確定。

---

## 8. 更新履歴

### 2026-06-25（請求書発行 機能設計・スキーマ確定）
- **[invoice-feature-design.md](./invoice-feature-design.md)** を新規作成（JOfficeInvoice の機能設計正本）。確定：採番＝年月＋連番（`YYYYMM-NNN`・請求対象月基準・行ロック原子採番）／適格＝前提で枠だけ（登録番号は設定後入力）／PDF＝PHPライブラリ(mPDF)サーバ生成／消費税端数＝切り捨て／支払期限＝3方式を請求ごと選択／発行済み訂正＝取消→再発行(物理削除しない)。
- `db/schema.sql` を更新：**`jo_invoice_seq`（採番カウンタ）追加・`jo_invoices.dueRule` 追加**（→全13テーブル）。`jo_invoices`/`jo_invoice_lines` の暫定を正式化。
- §7 の「請求書発行の機能設計」を解決済へ更新。

### 2026-06-25（DBスキーマ初版作成 `db/schema.sql`）
- 統合スキーマDDLの正本 **[../db/schema.sql](../db/schema.sql)** を新規作成（MySQL 5.7・InnoDB・utf8mb4_unicode_ci・`jo_` 接頭辞・全12テーブル）。既存9シート＋認証 `jo_users`＋請求書 `jo_invoices`/`jo_invoice_lines`（暫定）を統合。
- 設計判断3点を確定：①**列名は既存JSONキーに合わせ camelCase**（PHPを薄い通過層にし front-end／`allocation.js` を無改修）②**氏名はworklogs/billingsに保存せずAPIでJOIN付与**（billings.customer のみ未登録顧客の snapshot として残す）③**請求書3テーブルは暫定**（採番ルール・適格登録番号 T+13桁・宛名/住所の置き場所は請求書機能設計で確定）。
- FK方針：整合保証箇所のみFK（工程→業務区分／明細→請求書 CASCADE／目標→スタッフ／users→スタッフ SET NULL）。外部由来コード（billings.customerCode/invoiceItemCode・worklogs.customerCode・customer_staff）は**ソフト参照**（マッチング漏れは警告で扱い拒否しない）。
- 二重計上対策：`jo_customers.paymentMethod`（transfer/invoice）と `jo_billings.source`（csv/invoice/manual）を新設。

### 2026-06-25（環境確定・スペック更新・移行契機の追記）
- お名前.com（HLS・ステージング）の MySQL を実測し **5.7.44（純正MySQL・Source distribution）** と確認。X-Server の MySQL 5.7.x と一致したため、**DB＝MySQL 5.7 決め打ち・PHP 8.1 固定**を確定（§0-3・§2・§6）。MariaDB 考慮は不要に。
- §2 スペック表を最新化：お名前 RS→**ベーシック改名（2025-05-20）**、X-Server **DB数無制限化／NVMe SSD 500GB／自動バックアップ標準**。共通最安定条件（PHP8.1・MySQL5.7・8.0専用SQL不使用・集計はPHP・コード列VARCHAR・utf8mb4_unicode_ci）を表で明文化。
- ステージング用DB **`2vt7g_joffice_pro`** をお名前.com上に作成（接頭辞 `2vt7g_` 自動付与・照合 `utf8mb4_unicode_ci`・phpMyAdmin 5.2.1）。**Insight＋Invoice 共有の単一DB**、DBユーザーは専用最小権限（`joffice_app` 想定）、テーブルは `jo_` 接頭辞（§1）。
- **移行の契機＝請求書発行機能（JOfficeInvoice）** を §0-5 に追記。Insight と顧客マスタ・請求テーブルを共有＝同一DB同居。請求書は全面移行後に新基盤でネイティブ実装する方針。
- §3 のシート→テーブル対応を実態へ修正（**item_master 撤去済→items テーブルは作らない**、案2新シート3＋請求書2テーブルを追加、`jo_` 接頭辞・コード列VARCHAR）。§7 の解決済項目を反映。

### 2026-06-22（新規作成）
- デモ→本番（PHP＋MySQL）移行の実行戦略・環境構成・フォーク方針を新設。お名前.com（HLS・開発/検証）と X-Server（先方・本番）のスペック調査結果を反映。`/joffice-pro/` をステージングとして位置づけ、PHP 8.1系 / MySQL 5.7 互換のバージョン決め打ちを仮置き。認証・RBAC・スキーマは production-auth-db-memo.md を正本として参照。

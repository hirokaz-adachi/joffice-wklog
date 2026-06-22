# 本番移行設計メモ（PHP＋MySQL 化・環境戦略）

作成: 2026-06-22 ／ HLS（adachi）
位置づけ: デモ（静的フロント＋GAS＋スプレッドシート）から本番（PHP＋MySQL）へ移行する際の、**移行の実行戦略・環境構成・フォーク方針**をまとめたメモ。認証・RBAC・スキーマの方針は [production-auth-db-memo.md](./production-auth-db-memo.md) が正本で、本メモはそれを前提に「いつ・どこで・どう移すか」を扱う。確定仕様ではなく着手前のたたき台。
関連: [design.md](./design.md)（設計の正本）／[production-auth-db-memo.md](./production-auth-db-memo.md)（認証・DB・RBAC）／[handoff-code-2026-06-22.md](./handoff-code-2026-06-22.md)（実装ハンドオフ）／[handoff-2026-06-22.md](./handoff-2026-06-22.md)（事業フェーズ）

---

## 0. 結論（先に要点）

1. **段取り**: まず現デモ（GAS構成）で**詳細分析画面（工数フェーズ）まで実装して凍結** → その後フォークして PHP＋MySQL 化に着手する。フロントは大部分流用でき、差し替えは `backend.js` の通信層（JSONP→fetch）が中心。
2. **環境**: 現デモ `tools.h-linksystems.com/joffice/`（HLS契約・お名前.com）は**お客様公開のデモのまま凍結**。本番相当は同サーバの `tools.h-linksystems.com/joffice-pro/` に**ステージング（検証環境）**として構築する。**真の本番は先方契約の X-Server**。`/joffice-pro/` は本番そのものではなく「X-Server へ載せる前の検証環境」と位置づける。
3. **バージョン決め打ち（最重要）**: 開発（お名前.com）と本番（X-Server）で **PHP・MySQL のバージョンを揃える**。仮決めは **PHP 8.1系 / MySQL 5.7 互換**。X-Server の契約形態が判明し次第そちらに合わせて確定する。
4. **実データの扱い**: HLS自社サーバ（お名前.com）に**先方の実顧客データ（個人情報・請求額）を置かない**。ステージングは匿名化サンプル／デモデータで検証する。

---

## 1. 環境マップ

| 環境 | URL / 基盤 | 契約 | 構成 | 用途 | 状態 |
|---|---|---|---|---|---|
| デモ | `tools.h-linksystems.com/joffice/`（お名前.com） | HLS | 静的＋GAS＋スプレッドシート（JSONP） | 商談用・お客様公開 | 稼働中・**凍結予定** |
| ステージング | `tools.h-linksystems.com/joffice-pro/`（お名前.com） | HLS | 静的＋**PHP＋MySQL**（同一オリジン fetch） | 本番相当の検証 | **新規構築** |
| 本番 | X-Server（プラン未確定） | **人事オフィス** | 静的＋PHP＋MySQL | 実運用 | 未着手・契約確認待ち |

- デモとステージングは同じお名前.comサーバ上の**別ディレクトリ**。デモ（GAS）はそのまま、`/joffice-pro/` 配下にPHPアプリを新設する。
- ステージング→本番は基盤が違う（お名前.com→X-Server）ため、**バージョン差を吸収しておくことがステージングの価値**。揃っていないと「動いたのに本番で動かない」偽の安心になる。

---

## 2. 環境スペック調査結果（2026-06-22 時点）

| 項目 | お名前.com RSプラン（HLS・開発/検証） | X-Server スタンダード（本番候補） |
|---|---|---|
| PHP | 7.0〜**8.4**（LSAPI・管理画面で切替） | 最新〜8.x（切替可）。WordPress動作確認は 8.1 |
| DB | **MySQL**（DB数無制限・1DBあたり5GB） | **MySQL 5.7 / MariaDB 10.5 / 10.11** |
| SSH | 対応 | 対応 |
| 無料独自SSL | 対応（Let's Encrypt） | 対応（Let's Encrypt・自動更新） |
| cron | 対応 | 対応 |
| ディスク | 1TB SSD | 大容量SSD |
| phpMyAdmin | あり | あり |

出典:
- お名前.com RSプラン スペック（ヘルプ）: https://help.onamae.com/answer/20165
- お名前.com RSプラン完全ガイド: https://tools-online-system.com/onamae-server-rs-plan/
- エックスサーバー サーバー仕様一覧: https://www.xserver.ne.jp/manual/man_server_spec.php
- エックスサーバー データベース仕様一覧: https://www.xserver.ne.jp/manual/man_db_spec.php

**含意**:
- 両環境とも PHP＋MySQL・SSH・cron・無料SSL・phpMyAdmin が揃い、`/joffice-pro/` は実質フル機能のステージングとして成立する。
- 最大の注意点は **DBエンジン/バージョン差**。X-Server は MySQL 5.7 と MariaDB の選択肢があり、SQLの細部（関数・予約語・JSON型・既定照合順序）が分岐し得る。**先に1つへ決め打ちし両環境で揃える**。社労士事務所規模（顧問先約60社・スタッフ9名）はデータ量が軽量なので、枯れた **MySQL 5.7 互換**に寄せれば無難。
- PHP も本番に合わせて固定（仮 8.1系）。最新追従より「本番に合わせる」を優先。

---

## 3. アーキテクチャ移行の要点

詳細な認証・スキーマ・RBACは production-auth-db-memo.md を正本とする。本メモでは差分のみ。

- **通信層**: `backend.js` を JSONP（`<script>` 動的生成＋URLトークン）から、**同一オリジンの `fetch()`（PHPエンドポイント）**へ差し替える。同一オリジン化により httpOnly・Secure・SameSite な Cookie セッションが素直に使える（JSONP由来の制約が解消）。
- **フロント**: 既存 HTML/CSS/JS をほぼ流用。画面（index/worklog/staff/dashboard/master/targets/data-edit/analysis）は維持し、データ取得関数の実装だけ差し替える。`backend.js` のクライアント関数のシグネチャを保てば画面側の改修を最小化できる。
- **集計・配賦ロジック**: dashboard.js のクライアント集計（時間単価・達成率・工数按分・案2の主担当フォールバック）を、PHP（API層）または MySQL のクエリ/ビューへ移植。**指標定義は design.md 第5章、配賦は第6〜8章を正本**として一致させる。
- **シート→テーブル**: production-auth-db-memo.md 第4章の対応表（worklogs/staff/customers/task_types/billings/staff_targets ＋ users）に従う。`item_master`（品目）も items テーブルとして追加する。
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

1. **前提固定**: PHP＝8.1系 / DB＝MySQL 5.7 互換 に決め打ち（X-Server契約確定後に微調整）。お名前.com側の検証環境もこのバージョンに合わせる。
2. **X-Server契約確認**: 先方プラン（スタンダード/プレミアム/ビジネス or 旧プラン、もしくは XServerビジネス）の PHP・MySQL・SSH・無料SSL・DB上限を確認。判明後に本メモのバージョンを最終確定。
3. **フォーク**: 詳細分析画面完成コミットを基点に `joffice-pro` を作成（案(a)推奨）。
4. **検証環境構築**: `tools.h-linksystems.com/joffice-pro/` に PHP＋MySQL 環境を用意（BASIC認証で覆う）。MySQLスキーマ作成（production-auth-db-memo.md 第4章＋ users＋インデックス）。
5. **API実装**: PHPで参照・更新・認証APIを実装。`backend.js` を fetch ベースに差し替え。集計・配賦ロジックを移植。
6. **認証・認可**: 全APIにセッション検証＋ロール別フィルタを適用。staff.html にログイン画面追加。
7. **検証**: 匿名化サンプルで4指標・配賦・RBACの妥当性を確認。
8. **本番展開**: X-Server へ配置（FTPSデプロイ運用を流用）。スキーマ作成→データ取込→動作確認→切替。

---

## 7. 未確定・要確認

- **X-Server の契約形態**（最優先）。プランによりDB上限・PHP上限・SSH可否・SSL仕様が変わる。判明次第、第2章・第6章のバージョンを確定。
- **DBエンジンの最終選択**（MySQL 5.7 か MariaDB か）。X-Server側の推奨と合わせる。
- **案2（売上配賦の精緻化）の決着**。売上系指標・時間単価・達成率のロジックは案2（design.md 第8章）に依存。詳細分析画面の売上フェーズも案2待ち。移行前に案2を確定できれば、PHP側へ最終形のロジックを一度で移植できる。
- **GAS版と本番の並行運用期間**（一気に切替か、段階移行か）。
- **詳細分析画面の `analysis` を design.md 第3章の画面表へ反映**（実装完了時にまとめて）。

---

## 8. 更新履歴

### 2026-06-22（新規作成）
- デモ→本番（PHP＋MySQL）移行の実行戦略・環境構成・フォーク方針を新設。お名前.com（HLS・開発/検証）と X-Server（先方・本番）のスペック調査結果を反映。`/joffice-pro/` をステージングとして位置づけ、PHP 8.1系 / MySQL 5.7 互換のバージョン決め打ちを仮置き。認証・RBAC・スキーマは production-auth-db-memo.md を正本として参照。

# Claude Code 引き継ぎメモ — 詳細分析画面の実装

作成: 2026-06-22 ／ HLS（adachi）
引き継ぎ先: Claude Code（CLIでの開発作業）
最初の一言の例: 「sharoshi-worklog-mvp の続き。docs/handoff-code-2026-06-22.md と docs/design.md を読んで現状を把握して。これから詳細分析画面を作る」

> このメモは「開発を Code 側で続けるための実装ハンドオフ」です。事業フェーズ（PoC・データ依頼・見積）の引き継ぎは `docs/handoff-2026-06-22.md`、設計の正本は `docs/design.md` を参照。

---

## 0. まず読む順番

1. `docs/design.md` — 設計の正本（アーキ・データモデル・指標定義・配賦ロジック・既知の論点・API一覧・本番バックログ）。**第8章（案2）と第15章（デモ未実装スコープ）が今回の関連箇所**。
2. 本メモ — 現状コードの実体と、次タスク（詳細分析画面）の要件・決定事項。
3. （デプロイ時のみ）`DEPLOY.md` と clasp 手順（後述）。

---

## 1. プロジェクト概要

- 製品名: **J-Office Insight**（社労士法人 人事オフィス・櫻井所長向け）。
- 目的: 「請求の結果（売上）×工数」を集計し、4指標（クライアント別時間単価／スタッフ別時間単価／スタッフ別月次売上／目標達成率）を月次で可視化する生産性分析ツール。請求書発行システムではない。
- 構成: **静的フロント（HTML/CSS/JS・ビルド工程なし）＋ Google Apps Script ＋ Googleスプレッドシート（6シート）**。通信は **JSONP**（`backend.js` が `<script>` を動的生成してGASを呼ぶ）。
- リポジトリ: https://github.com/hirokaz-adachi/joffice-wklog （branch `main`）。
- デモURL（稼働中）: https://tools.h-linksystems.com/joffice/ （HLS自社レンタルサーバ、FTPS配信）。

---

## 2. リポジトリの現状（2026-06-22 時点）

git は **clean / origin/main と同期済み**（最新コミット `a844373`）。直近2コミットで「clasp導入＋GASバックエンド拡張」「マスタ／目標／データ編集の3画面追加」を反映済み。

### 画面ファイル

| 画面 | ファイル | 状態 |
|---|---|---|
| Topメニュー | `index.html`（自己完結・簡易PWゲート・作業登録QR埋込） | 既存 |
| 工数入力管理（PC） | `worklog.html` / `app.js` / `styles.css` | 既存 |
| 作業内容登録（モバイル） | `staff.html` / `staff.js` / `staff.css` | 既存 |
| 経営ダッシュボード | `dashboard.html` / `dashboard.js` / `dashboard.css` | 既存（モーダル2種あり） |
| マスタメンテナンス | `master.html` / `master.js` / `master.css` | **新規追加済み**（第15-1の一部） |
| 売上目標登録 | `targets.html` / `targets.js` / `targets.css` | **新規追加済み**（第15-1の一部） |
| データ訂正・編集 | `data-edit.html` / `data-edit.js` / `data-edit.css` | **新規追加済み**（第15-4の一部・Excelライク編集） |
| 共通 | `config.js`（.gitignore対象）/ `config.sample.js` / `backend.js` | 既存 |

> 注: `design.md` 第3章の画面表は master/targets/data-edit 追加前の記述。**設計書よりこのメモの方が画面構成は新しい**。design.md の更新は本タスク完了後にまとめて行う想定。

### バックエンド（`gas/Code.gs`）の現API

`doGet → route_(action, payload)`。token検証（`assertToken_`）＋ `LockService` 排他。更新系は `mutateDashboardData_` 経由でダッシュボードキャッシュを無効化。

| action | 種別 | 内容 |
|---|---|---|
| `bootstrap` | 参照 | staff/customers/taskTypes/entries |
| `dashboard` | 参照 | 集計用フルデータ（staff/customers/entries/billing/targets）。`payload.forceRefresh` でキャッシュ無視 |
| `saveEntry` / `saveEntries` / `deleteEntry` | 更新 | 工数 upsert / 一括 / 削除 |
| `upsertMaster` / `removeMaster` | 更新 | staff/customers マスタ（`oldCode` でコード変更可） |
| `saveBilling` / `saveBillings` / `deleteBilling` | 更新 | 請求データ（**新規追加済み**） |
| `saveTarget` / `saveTargets` / `deleteTarget` | 更新 | スタッフ別売上目標（**新規追加済み**） |

`backend.js` 側に対応クライアント関数あり: `loadState` / `loadDashboard` / `saveEntry(s)` / `deleteEntry` / `saveBilling(s)` / `deleteBilling` / `saveTarget(s)` / `deleteTarget` / `upsertMaster` / `removeMaster`。

### データモデル（スプレッドシート6シート・`CONFIG.headers` が正本）

| シート | カラム |
|---|---|
| worklogs | id, date, staffCode, staff, customerCode, customer, taskType, hours, memo, updatedAt |
| staff_master | code, name |
| customer_master | code, name |
| task_master | name |
| billing_data | invoiceId, billingMonth, customerCode, customer, invoiceItem, paymentMethod, netAmount, taxAmount, grossAmount, issuedDate, paymentDueDate, paymentStatus, memo |
| staff_target_master | targetMonth, staffCode, staff, targetAmount |

- 工数は「顧客直接（customerCodeあり）」と「社内/その他（customerCode空欄）」を区別。
- `billing_data.netAmount` ＝税抜。
- デモデータ: 2026年3〜5月、スタッフ6名（S001〜S006）、顧客46社、整合性確認済み。

---

## 3. 今回のタスク: 詳細分析画面（新規）

ダッシュボードとは別に、**スタッフ・顧客・業務区分などを多角的に掘れる探索的分析画面**を新設する。`design.md` 第15-2「スタッフ別 詳細分析画面」を一般化したもの。

### 決定事項（adachi と合意済み・2026-06-22）

1. **スコープは「クロス集計まで」**。単軸の推移・ランキングに加え、「スタッフ×業務区分」「顧客×スタッフ」等の2軸クロス集計（ピボット）まで対応する。
2. **工数分析を先行実装する**。売上を絡めた指標（帰属売上・時間単価・達成率）は配賦ロジック（案2）の決着に依存するため、**まず配賦と無関係な工数中心の分析を完成させ、売上系指標は案2実装後に載せる**。手戻りを最小化するのが狙い。
3. 役割分担: 既存ダッシュボード＝「月次の定点観測」、本画面＝「任意期間で掘る探索ツール」。同じ表を重複表示しない。本画面は推移・比較・クロス集計に振り切る。

### なぜ売上を後回しにするか（重要・design.md 第7-1章）

全体KPIの税抜売上は `billing_data` を全件合計する一方、スタッフへの配賦は「工数と請求の両方がある顧客」に限られる。任意期間でスタッフ別売上・達成率を集計すると、この未配賦のズレが期間合計にそのまま効く。案2（主担当フォールバック配賦＋売上を「配賦売上／工数対応売上」の2系統に分離）が未決のまま売上分析UIを作り込むと、案2導入時に集計ロジックの作り直しが発生する。**工数は配賦問題と無関係なので安全に先行できる**。

### 推奨実装方針

- **新規ファイル** `analysis.html` / `analysis.js` / `analysis.css`（命名は既存に倣う）。Topメニュー（`index.html`）とダッシュボードのナビにリンク追加。
- **データ取得は既存 `dashboard` API を再利用**（staff/customers/entries/billing/targets をフルで返す）。**GAS変更なし＝低リスク**でクライアント側集計だけで作れる。新APIは原則追加しない。
- 既存のブラウザキャッシュ（`worklog-dashboard-cache-v2`・TTL30分）に相乗りしてよい。
- **MVP（工数フェーズ）の構成案**:
  - 期間指定（任意の開始月〜終了月。design.md 15-2 の「集計期間の動的設定」必須要件）。
  - 軸選択（スタッフ / 顧客 / 業務区分）。
  - ① 月次推移チャート（選択軸 × 工数）、② ランキング/一覧（合計工数・構成比）、③ クロス集計表（例: スタッフ×業務区分の工数ピボット、顧客×スタッフの工数ピボット）。
  - 社内/非生産工数（customerCode空欄）の扱いを明示（含める/除く切替 or 別建て表示）。
- 売上系の指標は **後続フェーズ**。案2の実装（customer_master への主担当staff_id列追加・売上2系統化）を終えてから、同じ画面に売上・時間単価・達成率の軸を追加する。

### 既存コードの流儀（合わせること）

- ビルド工程なし。素のHTML/CSS/JS。チャートは dashboard.js が自前描画（外部ライブラリ非依存）なので踏襲推奨。
- アセット参照は **キャッシュバスター `?v=YYYYMMDD-n` 必須**（後述の事故対策）。新規HTMLでも各CSS/JS参照に付ける。
- 指標定義・色しきい値は dashboard.js を参照し整合させる（時間単価帯・達成率帯のしきい値はハードコード。design.md 7-3）。

---

## 4. デプロイ／運用（実行は Windows 側）

> **重要**: このフォルダは OneDrive 同期配下。**git・clasp・FTPSデプロイはすべて Windows 側で実行**する（Linux サンドボックスからは git を叩かない＝インデックス破損の表示崩れを起こすため）。

### git（Windows・PowerShell）

```powershell
cd "C:\Users\user\OneDrive\デスクトップ\HLSもろもろ\人事オフィス\sharoshi-worklog-mvp"
git add -A
git commit -m "..."
git push origin main
```

### 静的フロントの配信（FTPS / WinSCP・Windows）

```powershell
# 変更ファイルのみ配信
.\scripts\deploy.ps1 -Only analysis.html,analysis.js,analysis.css,index.html
```

- 配置先 `RemoteDir`: `/tools.h-linksystems.com/joffice/`。
- FTP認証は `scripts/deploy.config.ps1`（.gitignore対象）。

### GAS の反映（clasp・URL不変）

`Code.gs` を変更した場合のみ。

```
cd <repo>/sharoshi-worklog-mvp/gas
clasp push -f
clasp update-deployment AKfycbyisWQGRuGpUjw9CXmpzT9ojZXLp2eCxZm277IDxyPHksncl-Ru0E5ajeOGJMjiUBCH
```

- GASプロジェクト `joffice_wklog_proj`（スプレッドシート `joffice_wklog_demo` にコンテナバインド）。scriptId は `gas/.clasp.json`（.gitignore対象）。
- **障害対策（必須）**: `gas/appsscript.json` に `webapp` セクション（`executeAs: USER_DEPLOYING` / `access: ANYONE_ANONYMOUS`）が無いまま update-deployment すると exec URL が死んで全API停止。マニフェストは現状コミット済みなので消さないこと。
- 今回の詳細分析画面は **dashboard API 再利用＝GAS変更不要**の想定。clasp 作業は基本発生しない。

---

## 5. 落とし穴・注意点

- **キャッシュバスター**: 共通の `backend.js` は過去に `?v=` 無しで読まれ、更新後も旧版がキャッシュされて `saveTargets is not a function` 等の事故が発生した。現在は全HTMLが `backend.js?v=YYYYMMDD-n` 参照。**`backend.js` を変更したら必ず `?v=` 番号を上げ、全HTML＋backend.js を再配信**。
- **秘匿ファイル**: `config.js`（GAS APIトークン平文）・`scripts/deploy.config.ps1`・`gas/.clasp.json`・`.clasprc.json` は .gitignore 対象。コミットに含めない。
- **配賦の非対称**（再掲）: 売上系の集計は案2未決。詳細分析の売上指標は後続。
- **しきい値ハードコード**: 顧客時間単価（>=10000/>=7500）、スタッフ達成率（>=1.0/>=0.85）の色分けが dashboard.js にハードコード。

---

## 6. 完了時にやること

- design.md を更新（第3章の画面表に analysis 追加、第15-2 を実装済みに、更新履歴に追記）。本メモの「設計書より新しい画面構成」の差分も解消する。
- 工数フェーズ完了後、売上フェーズ（案2込み）の段取りを別途整理。

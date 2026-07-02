# JOffice Pro リファクタリング・性能見直し提案

作成日: 2026-06-29  
対象: `sharoshi-worklog-mvp/pro/`（PHP + MySQL 本番相当版）  
目的: Claude Code への引き継ぎ用。現時点では実装変更せず、性能・保守性の観点から今後検討すべき改善候補を整理する。

---

## 1. 前提

JOffice Pro は、現時点で主要機能がほぼ実装済みの状態にある。

- J-Office Insight: 工数入力、月間入力、ダッシュボード、詳細分析、工数訂正、請求訂正、CSV取込、目標、マスタ、ユーザー/RBAC
- J-Office Invoice: 請求書作成、下書き、確定発行、採番、印刷ビュー、取消、複製、`jo_billings` 連携
- 認証・権限: PHP/MySQL版で実装済み
- 配賦エンジン: `allocation.js` に実装済み。ローカル検証 `scripts/test-allocation.mjs`、`scripts/verify-demo.mjs` は全PASS確認済み

このため、今後の重点は「機能追加」よりも、実運用前の仕上げとして次を見直すこと。

- 性能
- データ量増加時の安定性
- APIの責務分離
- フロントエンドの再描画負荷
- 共通処理の重複削減
- 実データ移行・本番運用を見据えた保守性

---

## 2. 総評

性能面の本丸は、現在の実装にある次の傾向をどう整理するかである。

1. APIが画面用途に対してやや大きいデータを返す
2. フロント側で全件データを保持し、画面側で絞り込む
3. ダッシュボード・詳細分析で同じ月次配賦モデルを再生成しやすい
4. 一覧・表形式UIで `innerHTML = rows.map(...).join("")` 型の全量再描画が多い
5. 画面ごとに似たユーティリティ処理が散在している

現状規模（顧問先約60社、スタッフ9名前後）では大きな問題になりにくいが、複数年分の工数・請求・請求書データが蓄積すると、初期表示、分析画面、月間工数入力、請求照会の体感速度に効いてくる可能性が高い。

まずは大きなアーキテクチャ変更ではなく、以下の順に小さく効く改善から進めるのがよい。

1. API取得範囲の分割・絞り込み
2. `buildMonthModel()` の月別メモ化
3. Invoice系画面の軽量API化
4. 一覧・グリッド系画面のページングまたは仮想化
5. 共通ユーティリティ抽出

---

## 3. 優先度A: APIの取得範囲を画面別に絞る

### 現状

`pro/lib/handlers.php` の `jo_handle_dashboard()` は、概ね次をまとめて返している。

- staff
- customers
- tasks
- taskPhases
- customerStaff
- settings
- entries
- billing
- targets

多くの画面が `WorklogBackend.loadDashboard()` または `joBootstrap()` を使い、取得後にフロント側で必要部分だけを使っている。

### 課題

データが増えるほど、次の負荷が増える。

- APIレスポンスサイズ
- PHP側のJOIN・配列整形
- ブラウザ側のJSON parse
- フロント側のフィルタリング・集計
- 不要データを含む通信

特に請求書画面、ユーザー管理、マスタ編集などは、工数全件や請求全件が不要な場面が多い。

### 改善案

画面用途ごとに軽量APIを追加する。

候補:

| API | 用途 | 返す主なデータ |
|---|---|---|
| `bootstrap` | 工数入力系 | マスタ + 必要範囲の工数 |
| `dashboard` | 経営ダッシュボード | 指定月または指定期間の工数・請求・目標 |
| `analysisData` | 詳細分析 | `from` / `to` 指定の工数・請求・目標 |
| `billingList` | 請求 照会・訂正 | 指定月範囲・顧客の請求行 |
| `worklogList` | 工数 照会・訂正 | 指定日/月範囲・スタッフ・顧客の工数 |
| `masterData` | 請求書・マスタ系 | staff/customers/tasks/taskPhases/customerStaff/settings |
| `invoiceSettings` | 請求書設定 | `jo_app_settings` のうち発行者・請求書関連のみ |

既存画面を一気に差し替える必要はない。まずは新APIを追加し、重い画面から段階的に切り替える。

### 実装時の注意

- 既存 `WorklogBackend` 互換はすぐ壊さない
- まずは `backend.js` に新関数を追加し、既存関数は残す
- 月範囲指定は `YYYY-MM`、日範囲指定は `YYYY-MM-DD` に統一
- MySQL 5.7 前提なので、高度なSQLに寄せすぎない
- `jo_worklogs.date` は `WHERE date >= ? AND date < ?` で絞る
- `jo_billings.billingMonth` は `WHERE billingMonth BETWEEN ? AND ?` を標準にする

---

## 4. 優先度A: 配賦モデル `buildMonthModel()` の月別メモ化

### 現状

`allocation.js` の `buildMonthModel(data, billingMonth)` は、ダッシュボードや詳細分析の中核である。

実装はよく整理されており、役務売上・配賦対象外・税・工数按分・担当者フォールバックを一貫して扱っている。一方で、画面操作のたびに同じ月のモデルを再生成する余地がある。

### 課題

たとえばダッシュボードでは、同じ月について以下の処理が重なる可能性がある。

- KPI表示
- 売上構成
- スタッフ表
- 顧客表
- 顧客モーダルの12ヶ月推移

詳細分析でも、期間内の各月について `buildMonthModel()` を繰り返し呼ぶ箇所がある。

### 改善案

フロント側で月別メモ化する。

イメージ:

```js
const monthModelCache = new Map();

function getMonthModel(data, month) {
  const key = month;
  if (!monthModelCache.has(key)) {
    monthModelCache.set(key, JOfficeAllocation.buildMonthModel(data, month));
  }
  return monthModelCache.get(key);
}

function clearMonthModelCache() {
  monthModelCache.clear();
}
```

導入先候補:

- `pro/dashboard.js`
- `pro/analysis.js`

### キャッシュ破棄条件

- APIからデータを再取得したとき
- 工数、請求、目標、マスタ、工程、顧客担当、設定を更新した後
- `billingOffset` など配賦に影響する設定を変更した後

まずは画面単位のメモ化で十分。サーバ永続キャッシュやDB集計テーブルは後回しでよい。

---

## 5. 優先度A: Invoice系画面の軽量化

### 現状

請求書関連画面の一部で `joBootstrap()` を呼び、顧客・業務区分・設定などを取得している。

対象例:

- `pro/invoice-edit.html`
- `pro/invoice-print.html`
- `pro/invoice-list.html`
- `pro/invoice-settings.html`

### 課題

請求書編集・印刷・設定画面では、工数全件は不要なことが多い。`bootstrap` が工数も含む場合、画面用途に対して過剰取得になる。

### 改善案

Invoice系向けの軽量APIを作る。

候補:

- `invoiceMasterData`
  - customers
  - tasks
  - settings
- `invoiceSettings`
  - `issuer.*`
  - `invoice.*`
- `invoicePrintData`
  - 指定請求書ヘッダ
  - 明細
  - 発行者設定

特に `invoice-print.html` は印刷ビューなので、必要な請求書1件と設定だけ取得できる形が望ましい。

---

## 6. 優先度A: 一覧・グリッド画面のページング/仮想化

### 現状

以下の画面では、大きな表を `innerHTML = rows.map(...).join("")` で一括描画している箇所が多い。

- `pro/data-edit.js`
- `pro/app.js`
- `pro/worklog-month.js`
- `pro/analysis.js`
- `pro/master.js`
- `pro/users.html`
- `pro/invoice-list.html`

### 課題

数百件程度なら問題ないが、数千件以上になると次が重くなる。

- HTML文字列生成
- DOM差し替え
- イベント再設定
- レイアウト計算
- スクロール時の体感

### 改善案

画面ごとに適した方法を選ぶ。

| 画面 | 推奨 |
|---|---|
| 請求 照会・訂正 | 月範囲フィルタ + ページング |
| 工数 照会・訂正 | 日/月範囲フィルタ + ページング |
| 工数登録（月間） | 表示対象は1スタッフ×1ヶ月なので、まずはメモ化と差分更新で十分 |
| 詳細分析 | ランキング件数の上限、ピボットの上位N + その他 |
| 請求書一覧 | ページングまたは月単位フィルタ |

最初から本格的な仮想スクロールを作るより、まずはページングと表示件数上限でよい。

---

## 7. 優先度B: `joMe()` の重複呼び出し削減

### 現状

各HTMLの認証ガードと `pro/backend.js` の共通ヘッダ表示で、画面初期化時に `me` API が複数回呼ばれる可能性がある。

### 改善案

`backend.js` に `joEnsureMe()` のようなPromiseキャッシュを追加する。

イメージ:

```js
let JO_ME_PROMISE = null;

async function joEnsureMe(force = false) {
  if (!force && JO_ME_PROMISE) return JO_ME_PROMISE;
  JO_ME_PROMISE = joMe();
  return JO_ME_PROMISE;
}
```

各画面の `joMe()` 呼び出しを段階的に `joEnsureMe()` へ寄せる。

### 注意

- logout時はキャッシュを破棄する
- パスワード変更後やユーザー情報変更後に古い表示が残らないようにする
- まずは表示体感よりAPI数削減の小改善として扱う

---

## 8. 優先度B: 一括保存のトランザクション化

### 現状

`saveBillings`、`saveTargets`、`saveEntries` などはAPIとしては一括保存だが、内部的には1件ずつ保存する形が中心。

### 課題

大量行保存時に次の懸念がある。

- 途中失敗時の整合性
- 1件ごとのSQL実行回数
- レスポンス時間

### 改善案

PHP側で一括処理をトランザクションに包む。

対象候補:

- `saveEntries`
- `saveBillings`
- `saveTargets`
- `saveTaskPhases`
- `saveCustomerStaffs`

まずは「全部成功/全部失敗」の整合性確保を優先し、複数行INSERT最適化は後続でよい。

---

## 9. 優先度B: 共通ユーティリティの抽出

### 現状

各画面に似た処理が散在している。

- HTMLエスケープ
- 日付/月操作
- 金額・時間・割合フォーマット
- active/無効マスタの選択肢生成
- 顧客担当による候補並び替え
- トースト表示
- APIエラーの日本語化

### 改善案

ビルドレス構成を維持したまま、共通JSを小さく分ける。

候補:

| ファイル | 役割 |
|---|---|
| `pro/common-format.js` | 金額、時間、割合、日付、月操作 |
| `pro/common-ui.js` | escapeHtml、toast、confirm/error表示 |
| `pro/common-options.js` | staff/customer/task/phase の選択肢生成 |
| `pro/common-auth.js` | 画面ガード、role確認、mustChangePassword処理 |

ただし、共通化はやりすぎると差分が大きくなる。性能改善の本筋ではないため、API分割やメモ化の後に進める。

---

## 10. 優先度C: サーバ側集計APIまたは集計テーブル

### 現状

集計・配賦はフロント側 `allocation.js` を再利用している。これは仕様の一貫性が高く、現段階では良い判断。

### 将来の課題

複数年データ・多拠点・顧客数増加などが発生すると、毎回フロントで全データを集計する方式が重くなる可能性がある。

### 改善案

将来的には次を検討する。

- 月次KPIだけPHP側で算出して返す
- 月次集計テーブルを持つ
- 工数・請求更新時に該当月の集計キャッシュを破棄する
- cronで月次集計を再生成する

ただし、現時点でいきなりサーバ集計へ寄せる必要は薄い。まずは「取得範囲制限」「月別メモ化」「画面描画改善」の方が効果とリスクのバランスがよい。

---

## 11. 推奨着手順

### Step 1: 計測ポイントを入れる

本格改修前に、最低限の計測を入れる。

- API取得時間
- レスポンスサイズ
- `buildMonthModel()` の実行回数・時間
- 主要画面の初期表示時間
- 一覧描画件数と描画時間

既に一部画面では `performance.now()` による取得時間表示がある。これを少し広げる。

### Step 2: `buildMonthModel()` の画面内メモ化

対象:

- `pro/dashboard.js`
- `pro/analysis.js`

比較的低リスクで効果が見やすい。

### Step 3: Invoice系の軽量API

対象:

- `invoice-edit`
- `invoice-print`
- `invoice-settings`
- `invoice-list`

`joBootstrap()` 依存を軽くする。

### Step 4: `dashboard` / `analysis` の期間指定

`from` / `to` を受け取り、PHP側で工数・請求・目標を絞る。

### Step 5: 一覧系のページング

対象:

- 請求 照会・訂正
- 工数 照会・訂正
- 請求書一覧

---

## 12. 改修時の注意

- 設計正本は `docs/design.md`、認証/RBACは `docs/rbac-matrix.md`、請求書は `docs/invoice-feature-design.md`
- MySQL 5.7 前提を維持する。CTE、ウィンドウ関数、`JSON_TABLE` などMySQL 8専用機能は使わない
- コード列はVARCHAR/CHARのまま。顧客コード `0001`、業務コード `026` の前ゼロを落とさない
- `allocation.js` の仕様を壊さない。変更時は `scripts/test-allocation.mjs`、`scripts/verify-demo.mjs` を必ず実行する
- 認可はフロントではなくPHP API側で担保する
- `config.php`、FTP設定、DB接続情報などのシークレットはコミットしない
- 既存の画面導線・action名互換は段階的に維持する
- 大きな共通化を先にやりすぎない。まず性能上効くところから小さく進める

---

## 13. まとめ

現時点のPro版は、機能面ではかなり完成度が高い。性能・保守性の観点では、まず次の4点が最も効果的。

1. 画面別・期間別にAPI取得範囲を絞る
2. `buildMonthModel()` を月別にメモ化する
3. Invoice系画面を軽量APIへ寄せる
4. 一覧・グリッド画面にページングまたは表示上限を入れる

この順番なら、既存仕様を壊しにくく、体感速度にも効きやすい。


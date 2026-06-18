# sharoshi-worklog-mvp 設計資料（現状スナップショット）

作成日: 2026-06-18 ／ 作成: HLS（adachi）
対象: 社労士法人 人事オフィス・櫻井所長 向け「売上×工数 生産性分析ツール」MVP
位置づけ: 主担当フォールバック配賦（案2）改修に着手する**前**の現状設計を記録したもの。改修はこの版を基点に行う。
関連: `../売上工数分析ツール_構想メモ_v1.md`（要件構想）, `../DEPLOY.md`（配置手順）

---

## 1. 目的とスコープ

請求業務そのものは既存SaaSを継続利用する前提で、「請求の結果（売上）＋工数」を集計し、次の指標を月次で自動可視化する分析ツール。請求書発行システムではない。

可視化する主要4指標（構想メモ準拠）:

1. クライアント別の時間単価（売上 ÷ 投下工数）
2. スタッフ別の時間単価（帰属売上 ÷ 稼働工数）
3. スタッフ別の月次売上（帰属売上）
4. スタッフ別の売上目標達成率（帰属売上 ÷ 目標）

---

## 2. 全体アーキテクチャ

3層構成。サーバ側ロジックは持たず、静的フロント＋GAS＋スプレッドシートで完結する軽量構成。

- フロントエンド: HLSレンタルサーバ上の静的ファイル（HTML/CSS/JS）。ビルド工程なし。
- バックエンドAPI: Google Apps Script（`gas/Code.gs`）をウェブアプリとしてデプロイ。
- データストア: Googleスプレッドシート（6シート）。

通信方式は **JSONP**（`backend.js` が `<script>` タグを動的生成してGASを呼ぶ）。静的サイトからCORS制約なしで呼べる反面、後述のセキュリティ制約がある。

```
[ブラウザ: index/staff/dashboard]
        │  JSONP (?action=...&token=...&payload=...&callback=...)
        ▼
[GAS Web App: doc/Code.gs  doGet → route_]
        │  SpreadsheetApp
        ▼
[Google Spreadsheet: worklogs ほか6シート]
```

### データフロー
- 参照系: `bootstrap`（マスタ＋工数）, `dashboard`（集計用フルデータ）。
- 更新系: `saveEntry` / `saveEntries` / `deleteEntry` / `upsertMaster` / `removeMaster`。更新時はGAS側ダッシュボードキャッシュを無効化。

---

## 3. 画面構成

| 画面 | ファイル | 用途 |
|---|---|---|
| 工数入力管理（PC） | `index.html` / `app.js` / `styles.css` | カレンダー＋日次入力、一覧・フィルタ、マスタメンテ、CSV入出力 |
| 作業内容登録（モバイル） | `staff.html` / `staff.js` / `staff.css` | スタッフが現場で打つ簡易入力。時/分ステッパUI |
| 経営ダッシュボード | `dashboard.html` / `dashboard.js` / `dashboard.css` | 月次KPI・推移・スタッフ別／顧客別の生産性分析 |
| 共通 | `config.js` / `backend.js` | 接続設定とAPIクライアント |

`config.js` は接続情報（storageMode / apiBaseUrl / apiToken）。`storageMode: "local"` でローカル保存にフォールバック可能。

---

## 4. データモデル（スプレッドシート6シート）

GAS `CONFIG.headers` が正本。デプロイ済みスプレッドシート `joffice_wklog_demo` と一致を確認済み（2026-06-18）。

| シート | カラム |
|---|---|
| worklogs | id, date, staffCode, staff, customerCode, customer, taskType, hours, memo, updatedAt |
| staff_master | code, name |
| customer_master | code, name |
| task_master | name |
| billing_data | invoiceId, billingMonth, customerCode, customer, invoiceItem, paymentMethod, netAmount, taxAmount, grossAmount, issuedDate, paymentDueDate, paymentStatus, memo |
| staff_target_master | targetMonth, staffCode, staff, targetAmount |

補足:
- 工数は「顧客直接（customerCodeあり）」と「社内/その他（customerCode空欄）」を区別する。
- billing_data は請求結果（顧問先別・請求項目別の売上）。`netAmount`＝税抜。
- staff_target_master はスタッフ×月の売上目標。

### デモデータの現状（2026-06-18時点）
- 期間: 2026年3月・4月・5月の3か月が工数・請求・目標すべてで揃っている。
- スタッフ: S001〜S006 の6名で全シート整合。
- 整合性: 各月とも「スタッフ帰属売上合計＝税抜売上」で未配賦ゼロ、全体達成率＝スタッフ合計達成率（118.6% / 116.3% / 115.4%）。
- 既知の軽微点: 2026-03-03 に C010「エイチリンクシステムズ」（自社・テスト入力と思われる）の工数2.0hが1件あり、同顧客に請求が無いため3月の顧客別表に時間単価¥0（赤）で表示される。

---

## 5. 指標の定義（dashboard.js: buildMonthModel / renderKpis）

### 全体KPI（対象月）
| KPI | 定義 |
|---|---|
| 税抜売上 | その月の billing_data の netAmount 合計（**全件**） |
| 総工数 | その月の worklogs の hours 合計 |
| 顧客業務比率 | 顧客直接工数 ÷ 総工数 |
| 顧客平均時間単価 | 税抜売上 ÷ 顧客直接工数 |
| 売上目標達成率 | 税抜売上 ÷ 目標合計 |

### スタッフ別
| 指標 | 定義 |
|---|---|
| 帰属売上 | 工数按分で配賦された売上（後述） |
| 目標 | staff_target_master のその月合計 |
| 達成率 | 帰属売上 ÷ 目標 |
| 顧客工数 | 顧客直接工数 |
| 総工数 | 顧客直接＋社内 |
| 直接時間単価 | 帰属売上 ÷ 顧客直接工数 |
| 総合生産性 | 帰属売上 ÷ 総工数 |

### 顧客別
| 指標 | 定義 |
|---|---|
| 税抜売上 | その顧客の netAmount 合計 |
| 顧客工数 | その顧客への直接工数合計 |
| 時間単価 | 税抜売上 ÷ 顧客工数 |
| 主担当 | **その月に最も工数を入れたスタッフ（工数から逆算）** |
| 請求内訳 | invoiceItem 別の売上 |

---

## 6. 配賦ロジック（現状：工数按分方式）

構想メモ4章の(2)工数按分方式を採用。月内で、顧客売上をその顧客に投下した工数比でスタッフへ配賦する。

擬似コード（dashboard.js buildMonthModel）:

```
for each customer:
    if (customer.hours == 0 || customer.revenue == 0): continue   // ★ここが論点
    for each staff who logged hours on this customer:
        staff.revenue += customer.revenue * (staff.hoursOnCustomer / customer.hours)
```

**前提条件**: 顧客に「工数」と「請求」の**両方**がある場合のみ配賦が発生する。

---

## 7. 既知の論点・制約

### 7-1. 配賦の非対称（最重要・改修対象）
全体KPIの「税抜売上」は billing_data を**全件合計**する一方、スタッフへの配賦は「工数と請求の両方がある顧客」に限られる。したがって**請求はあるが工数記録がゼロの顧問先**が存在する月では:

- その売上は総売上には算入されるが、どのスタッフの帰属売上にも乗らない（＝未配賦）。
- スタッフ帰属売上の合計 ＜ 全体の税抜売上。
- 全体達成率（税抜売上÷目標）＞ スタッフ別達成率の合計。
- 顧客平均時間単価は分子に工数ゼロ顧客の売上が入り分母には入らず、実態より高めに出る。
- その顧問先は顧客別表に「工数0h・時間単価¥0」で表示される。

社労士事務所では「顧問料は毎月請求するが当月は工数未記録」が普通に起こり得るため、本番データでは高確率で顕在化する。現デモデータでは該当ゼロのため未発生。

→ **改修方針（案2）**: 工数ゼロの請求顧客は customer_master の主担当へフォールバック配賦する。ただし時間単価・生産性が歪まないよう、売上を2系統に分ける必要がある（第8章）。

### 7-2. 主担当の出どころ
現状の「主担当」は工数の最多入力者から逆算しているため、**工数ゼロの顧客では主担当を決定できない**。案2の前提として customer_master に主担当staff_id 列の追加が必要。

### 7-3. しきい値ハードコード
顧客時間単価の色分け（rate>=10000:良 / >=7500:中 / 未満:低）、スタッフ達成率の色分け（>=1.0 / >=0.85）が dashboard.js にハードコード。所長の基準に合わせ調整余地あり。

### 7-4. セキュリティ
JSONP＋URLクエリにトークンを載せる方式で、`config.js` にトークンが平文。初回デモ用途では許容だが、本番は認証・権限・監査ログ・レート制限・編集履歴の設計が必要（DEPLOY.md 注記済み）。リポジトリでは `config.js` を .gitignore 対象とし、`config.sample.js` をプレースホルダとして管理する。

### 7-5. スタッフマスタの規模
seed-sample スクリプトは15名分を含むが、現行デモは reseed-six（6名）で運用。マスタ・工数・目標は6名で整合済み。

---

## 8. 今後の改修予定（案2：主担当フォールバック配賦）

方針: 売上を用途別に2系統へ分離する。

1. **配賦売上（達成率・月次売上用）** ＝ 工数按分 ＋ 主担当フォールバック。全額が必ず誰かに乗るため、合計が税抜売上と一致し達成率の不整合が消える。
2. **工数対応売上（時間単価・生産性用）** ＝ 工数の裏付けがある売上のみ（フォールバック分は除外）。時間単価＝工数対応売上 ÷ 直接工数 とし、指標の意味を保つ。

付随対応:
- customer_master に主担当staff_id 列を追加（未設定時の扱いを決める）。
- スタッフ詳細に「帰属売上 ¥X（うち工数未記録の顧問料 ¥Y）」の内訳表示。
- 担当顧客内訳の工数0h顧客は時間単価を「¥0」ではなく「—（工数未記録）」表示に変更。

---

## 9. キャッシュ戦略

- GAS側: `dashboard` 結果を ScriptCache に gzip+base64 で保存（既定300秒、95KB超は保存スキップ）。更新系API実行時に無効化。
- ブラウザ側: dashboard データを localStorage にキャッシュ（キー `worklog-dashboard-cache-v2`、TTL 30分、apiBaseUrl が変わると破棄）。初回は前回キャッシュを即表示し裏で更新する。

---

## 10. API一覧（GAS doGet → route_）

| action | 種別 | 内容 |
|---|---|---|
| bootstrap | 参照 | staff/customers/taskTypes/entries |
| dashboard | 参照 | 集計用フルデータ（staff/customers/entries/billing/targets） |
| saveEntry / saveEntries | 更新 | 工数の登録・更新（id必須・upsert） |
| deleteEntry | 更新 | 工数削除 |
| upsertMaster | 更新 | staff/customers マスタのupsert（oldCode指定でコード変更可） |
| removeMaster | 更新 | マスタ削除 |

認証: `CONFIG.apiToken` と一致しないトークンは拒否。排他: 参照・更新とも LockService でスクリプトロック。

---

## 11. セットアップ／デプロイ

詳細は `../DEPLOY.md` を参照。要点:
1. スプレッドシート新規作成 → Apps Scriptに `gas/Code.gs` を貼付 → `setup()` 実行でシート生成。
2. ウェブアプリとしてデプロイし、発行URLを取得。
3. `config.js` に apiBaseUrl と apiToken を設定（リポジトリ管理外。`config.sample.js` を複製して作成）。
4. 静的ファイル一式をレンタルサーバの同一ディレクトリへ配置（`gas/` `docs/` `scripts/` はサーバ配置不要）。

---

## 12. リポジトリ構成

```
sharoshi-worklog-mvp/
├── index.html / app.js / styles.css            # 工数入力管理（PC）
├── staff.html / staff.js / staff.css           # 作業登録（モバイル）
├── dashboard.html / dashboard.js / dashboard.css  # 経営ダッシュボード
├── backend.js                                  # JSONP APIクライアント
├── config.js          # 接続設定（.gitignore対象・各環境で作成）
├── config.sample.js   # 接続設定のプレースホルダ（コミット対象）
├── gas/Code.gs        # GASバックエンド
├── scripts/           # サンプルデータ投入スクリプト
├── docs/design.md     # 本資料
└── DEPLOY.md          # 配置手順
```

# JOffice (pro) 画面グルーピング & RBAC マトリクス

作成: 2026-06-25 ／ HLS（adachi）
位置づけ: PHP＋MySQL 版（pro）の**画面グルーピング**と、ロール（admin/manager/staff）別の**メニュー表示・操作権限**の正本。認証/RBAC 基盤は [production-auth-db-memo.md](./production-auth-db-memo.md)、移行は [migration-plan-php-mysql-2026-06-22.md](./migration-plan-php-mysql-2026-06-22.md)。

## ロール
- **admin（管理者）**：全画面・全操作。複数名可。
- **manager（マネージャ）**：分析で全スタッフを閲覧＋自分の工数入力。運用・管理は不可。
- **staff（一般）**：自分の工数入力のみ。

## 画面グルーピング（メニュー）
| グループ | 画面 | ファイル | 表示ロール |
|---|---|---|---|
| 工数入力 | 工数登録（スマホ） | staff.html | admin / manager / staff |
| 工数入力 | 工数登録（月間） | worklog-month.html | admin / manager / staff |
| 分析 | 経営ダッシュボード | dashboard.html | admin / manager |
| 分析 | 詳細分析 | analysis.html | admin / manager |
| 運用 | 工数 照会・訂正 | worklog.html | admin |
| 運用 | 請求 照会・訂正 | data-edit.html | admin |
| 運用 | 売上目標設定 | targets.html | admin |
| 運用 | 請求書発行（今後） | （invoice 予定） | admin |
| 管理 | マスタメンテナンス | master.html | admin |
| 管理 | ユーザー管理 | users.html | admin |

ログイン `login.html`／パスワード変更 `change-password.html` は全ロール共通の認証ゲート。

## 操作権限マトリクス
| 画面 | admin | manager | staff |
|---|---|---|---|
| 工数登録（スマホ／月間） | 全スタッフ分を入力・編集 | 自分のみ入力・編集 | 自分のみ入力・編集 |
| 経営ダッシュボード／詳細分析 | 閲覧（全社） | 閲覧（全社） | ✕ |
| 工数 照会・訂正 | 全件 閲覧＋訂正 | ✕ | ✕ |
| 請求 照会・訂正 | 閲覧＋編集＋CSV取込 | ✕ | ✕ |
| 売上目標設定 | 編集 | ✕ | ✕ |
| マスタメンテナンス | 全CRUD | ✕ | ✕ |
| ユーザー管理 | 全CRUD | ✕ | ✕ |
| パスワード変更 | 本人 | 本人 | 本人 |

## 実装上の担保（多層）
1. **メニュー表示**：`index.html` の各カードに `data-roles` を付与し、ログイン役割で表示/非表示。表示カードが0のグループは見出しごと非表示。
2. **画面ガード**：各画面 HTML の `joMe()` 後に役割チェック。不一致→`index.html`、初回PW未変更→`change-password.html`、未ログイン→`login.html`（URL直打ち対策）。
3. **API認可（最終防衛線・PHP側）**：
   - `dashboard`：admin / manager。
   - 工数 `saveEntry(s)`/`deleteEntry`：`role!==admin` は**本人の staffCode のみ**（manager も他人不可）。
   - `saveBilling(s)`/`deleteBilling`／`saveTarget(s)`／`upsertMaster`/`removeMaster`／工程／顧客担当／設定：admin のみ。
   - `listUsers`/`saveUser`/`deleteUser`：admin。`changePassword`：本人。
   - `bootstrap`：ログイン必須。`entries` は staff のみ本人に絞る（manager/admin は全件）。

## 前提・注意
- **工数入力の「自分」プリセット/制限は、ユーザーに `staffCode` 紐付けが必須**。未紐付けだと本人を特定できず制限が効かない（ユーザー管理で必ず紐付ける）。admin も自分を初期選択にするには紐付けが必要。
- manager は「分析で全社を閲覧」するが「工数入力は自分のみ」。運用（照会訂正・目標・請求）と管理は admin 専用。
- staff 向けダッシュボードは非公開方針（分析は manager 以上）。

## 更新履歴
### 2026-06-25（新規作成）
- 画面グルーピング（工数入力／分析／運用／管理）とロール別メニュー表示・操作権限を確定。スタッフ＝工数入力のみ／マネージャ＝工数入力＋分析／管理者＝全部。pro の各画面ガード・API認可・メニュー `data-roles` を本表に整合。

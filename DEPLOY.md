# デモ配置手順

## 構成

- HLSレンタルサーバ: `index.html`, `worklog.html`, `staff.html`, `dashboard.html`, `styles.css`, `staff.css`, `dashboard.css`, `app.js`, `staff.js`, `dashboard.js`, `backend.js`, `config.js`
- Googleスプレッドシート: `worklogs`, `staff_master`, `customer_master`, `task_master`, `billing_data`, `staff_target_master`
- Google Apps Script: `gas/Code.gs`

## Google Apps Script

1. Googleスプレッドシートを新規作成する。
2. 拡張機能 > Apps Script を開く。
3. `gas/Code.gs` の内容を貼り付ける。
4. `CONFIG.apiToken` を任意のデモ用トークンに変更する。
5. `setup()` を一度実行してシートを作成する。
6. デプロイ > 新しいデプロイ > ウェブアプリ。
7. 実行ユーザー: 自分。
8. アクセスできるユーザー: デモ方針に応じて選択。
9. 発行されたウェブアプリURLを控える。

`Code.gs` を更新した場合は、デプロイ管理から既存ウェブアプリを新しいバージョンへ更新する。
既存のウェブアプリURLはそのまま利用できる。

## フロント設定

`config.js` を次のように変更する。

```js
window.WORKLOG_CONFIG = {
  storageMode: "sheets",
  apiBaseUrl: "https://script.google.com/macros/s/XXXX/exec",
  apiToken: "Code.gs側と同じトークン"
};
```

ローカル保存に戻す場合は `storageMode: "local"` にする。

## レンタルサーバへアップロード

`outputs/sharoshi-worklog-mvp/` 直下の次のファイルを同じディレクトリに配置する。

- `index.html`
- `worklog.html`
- `staff.html`
- `dashboard.html`
- `styles.css`
- `staff.css`
- `dashboard.css`
- `app.js`
- `staff.js`
- `dashboard.js`
- `backend.js`
- `config.js`

`gas/` と `DEPLOY.md` はサーバ配置不要。

## 注意

このデモAPIは静的サイトから呼びやすくするためJSONP方式です。初回デモ用途としては扱いやすい一方、本番運用では認証、権限、監査ログ、レート制限、編集履歴の設計を追加してください。

# joffice-pro（PHP＋MySQL 本番相当）

J-Office Insight ＋ Invoice の本番相当（PHP＋MySQL）アプリ。デモ（GAS版・リポジトリ直下／`/joffice/`）とは独立し、`/joffice-pro/` に配置する。設計の正本は [../docs/migration-plan-php-mysql-2026-06-22.md](../docs/migration-plan-php-mysql-2026-06-22.md)・[../docs/production-auth-db-memo.md](../docs/production-auth-db-memo.md)・[../docs/invoice-feature-design.md](../docs/invoice-feature-design.md)、DDLは [../db/schema.sql](../db/schema.sql)。

## 構成

```
pro/
├── api.php            # フロントコントローラ（?action= ルーティング・JSON応答）
├── login.html         # ログイン／疎通確認(ping/me)UI
├── backend.js         # fetch APIクライアント（JSONP廃止・同一オリジン）
├── setup_admin.php    # 初期管理者作成（1回のみ・実行後削除）
├── .htaccess          # ルート（index・Indexes禁止・内部ファイル保護・BASIC覆いの雛形）
└── lib/               # PHP内部（HTTP直アクセス禁止＝lib/.htaccess）
    ├── config.php         # 接続情報・setup_key（.gitignore対象・各環境で作成）
    ├── config.sample.php  # config.php のテンプレート（コミット対象）
    ├── db.php             # PDO接続・設定取得
    ├── helpers.php        # JSON応答・入力取得
    └── auth.php           # セッション・ログイン・RBAC・CSRF
```

方針：通信は同一オリジン `fetch()`＋httpOnly セッションCookie。action 名・JSONペイロードは GAS 版を踏襲し、画面側の改修を最小化。集計・配賦は当面**クライアント側 `allocation.js` を再利用**（PHPは生データを返す）。コード列は VARCHAR、文字セットは utf8mb4。

## セットアップ手順

1. **DB**：`2vt7g_joffice_pro` に [../db/schema.sql](../db/schema.sql) を適用済み（phpMyAdmin インポート）。
2. **接続設定**：`lib/config.sample.php` を `lib/config.php` にコピーし、DBユーザー／パスワード／`setup_key`（長いランダム文字列）を設定。`lib/config.php` はコミットしない。
3. **配信**：`powershell -ExecutionPolicy Bypass -File scripts\deploy-pro.ps1`（FTPS で `/joffice-pro/` へ `pro\` 配下を同期。`deploy.config.ps1` のFTP情報を流用）。
4. **初期管理者作成**：ブラウザで
   `/joffice-pro/setup_admin.php?setupKey=（setup_key）&loginId=admin&password=（8文字以上）&displayName=管理者`
   を1回開く → 成功したら **`setup_admin.php` をサーバから削除**。
5. **疎通確認**：`/joffice-pro/login.html` を開き、
   - 「疎通確認 (ping)」で `PHP x.x / DB OK / env staging` を確認
   - 作成した管理者でログイン → 「セッション確認 (me)」でログイン保持を確認

## 実装状況（2026-06-25）

- 実装済：基盤（PDO・JSON・セッション）／認証（login/logout/me・bcrypt・ロックアウト・CSRF土台）／`ping`。
- 次段階：`bootstrap`（マスタ＋工数を GAS 同形JSONで返却・ロール別フィルタ）→ `dashboard` ほか read → save 系 → 各画面の移行 → 請求書発行（mPDF）。

## メモ

- ローカルにPHPランタイムが無いため、検証は実機（お名前.com `/joffice-pro/`）で行う。
- `setup_admin.php` は `setup_key` 必須かつユーザー存在時は 409。**実行後は必ず削除**すること。
- デプロイ初回に `/joffice-pro/` が未作成で synchronize が失敗する場合は、FTP/ファイルマネージャで空フォルダ `/joffice-pro/` を作ってから再実行する。

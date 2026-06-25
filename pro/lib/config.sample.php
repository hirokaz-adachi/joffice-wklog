<?php
// pro/lib/config.php のテンプレート。
// このファイルをコピーして pro/lib/config.php を作成し、実値を設定してください。
// config.php は .gitignore 対象（DB接続情報・setup_key を含むためコミットしない）。
return [
    'db' => [
        // お名前.com「データベース詳細 ＞ 接続先ホスト」の値。localhost ではない！（例 mysql92.onamae.ne.jp）
        'host'    => 'mysqlXX.onamae.ne.jp',
        'name'    => '2vt7g_joffice_pro',   // データベース名
        'user'    => '2vt7g_joffice_app',   // DBユーザー名（データベース詳細 ＞ ユーザー一覧）
        'pass'    => 'xxxxxxxx',            // DBユーザーのパスワード
        'charset' => 'utf8mb4',
    ],

    // セッションCookieの Secure 属性（HTTPS配信なら true）
    'cookie_secure' => true,

    // 環境名。'production' 以外ではエラー詳細をレスポンスに含める（staging デバッグ用）
    'env' => 'staging',

    // 初期管理者作成スクリプト(setup_admin.php)用の合言葉。長いランダム文字列に。
    'setup_key' => 'change-me-to-a-long-random-string',
];

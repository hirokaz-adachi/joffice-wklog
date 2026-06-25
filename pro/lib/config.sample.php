<?php
// pro/lib/config.php のテンプレート。
// このファイルをコピーして pro/lib/config.php を作成し、実値を設定してください。
// config.php は .gitignore 対象（DB接続情報・setup_key を含むためコミットしない）。
return [
    'db' => [
        'host'    => 'localhost',          // お名前.com 共用サーバは通常 localhost
        'name'    => '2vt7g_joffice_pro',  // データベース名
        'user'    => 'xxxxxxxx',           // DBユーザー名
        'pass'    => 'xxxxxxxx',           // DBパスワード
        'charset' => 'utf8mb4',
    ],

    // セッションCookieの Secure 属性（HTTPS配信なら true）
    'cookie_secure' => true,

    // 環境名。'production' 以外ではエラー詳細をレスポンスに含める（staging デバッグ用）
    'env' => 'staging',

    // 初期管理者作成スクリプト(setup_admin.php)用の合言葉。長いランダム文字列に。
    'setup_key' => 'change-me-to-a-long-random-string',
];

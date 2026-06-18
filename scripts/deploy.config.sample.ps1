# deploy.config.ps1 のテンプレート。
# このファイルをコピーして scripts\deploy.config.ps1 を作成し、実値を設定してください。
# deploy.config.ps1 は .gitignore 対象（FTP認証情報を含むためコミットしない）。

$FtpHost   = "ftp.example.com"        # お名前.com のFTPサーバ名（コントロールパネルで確認）
$FtpUser   = "your-ftp-user"          # FTPアカウント名
$FtpPass   = "your-ftp-password"      # FTPパスワード
$RemoteDir = "/joffice/"              # 公開ディレクトリ内の配置先（例: /joffice/ または /public_html/joffice/）

# WinSCP.com のパス。PATH に無い場合のみ指定（既定の探索で見つかれば不要）
# $WinScpCom = "C:\Program Files (x86)\WinSCP\WinSCP.com"

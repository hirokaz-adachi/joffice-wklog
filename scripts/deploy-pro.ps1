# joffice-pro（PHP＋MySQL 本番相当）を FTPS で /joffice-pro/ へ配信する。
# 認証情報は scripts\deploy.config.ps1（デモ用と同じFTPアカウント）を流用し、
# 配置先だけ /joffice-pro/ に差し替える。pro\ 配下を再帰的にアップロードする。
#
# 使い方:
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-pro.ps1
#
# 注意:
#   - pro\lib\config.php（DB接続情報・setup_key）はローカルにのみ存在し .gitignore 対象。
#     本コマンドでサーバへ配信される（config は実機に必要）。
#   - 初回は配信後に /joffice-pro/setup_admin.php で管理者を作成し、その後 setup_admin.php を削除する。
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$proDir = Join-Path $root 'pro'
Set-Location $root
Write-Host "== joffice-pro deploy (FTPS / WinSCP) =="

if (-not (Test-Path $proDir)) { Write-Host "!! pro\ がありません: $proDir"; exit 1 }

# 1) 設定読み込み（デモ用 deploy.config.ps1 を流用。RemoteDir はここで上書き）
$cfg = Join-Path $PSScriptRoot 'deploy.config.ps1'
if (-not (Test-Path $cfg)) {
  Write-Host "!! 設定ファイルがありません: $cfg"
  Write-Host "   scripts\deploy.config.sample.ps1 をコピーして deploy.config.ps1 を作成してください。"
  exit 1
}
. $cfg
if (-not $FtpHost -or -not $FtpUser -or -not $FtpPass -or -not $RemoteDir) {
  Write-Host "!! deploy.config.ps1 の FtpHost / FtpUser / FtpPass / RemoteDir を設定してください。"
  exit 1
}
# デモの RemoteDir(.../joffice/) と同じ階層に joffice-pro を配置（ドメインフォルダ構成に自動追従）
$base = $RemoteDir.TrimEnd('/')
$idx  = $base.LastIndexOf('/')
$parent = if ($idx -ge 0) { $base.Substring(0, $idx + 1) } else { '/' }
$ProRemoteDir = $parent + 'joffice-pro/'

# 2) WinSCP.com を探す
$winscp = $null
if ($WinScpCom -and (Test-Path $WinScpCom)) {
  $winscp = $WinScpCom
} else {
  $candidates = @(
    "$env:ProgramFiles\WinSCP\WinSCP.com",
    "${env:ProgramFiles(x86)}\WinSCP\WinSCP.com",
    "$env:LOCALAPPDATA\Programs\WinSCP\WinSCP.com"
  )
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { $winscp = $c; break } }
  if (-not $winscp) {
    $cmd = Get-Command WinSCP.com -ErrorAction SilentlyContinue
    if ($cmd) { $winscp = $cmd.Source }
  }
}
if (-not $winscp) {
  Write-Host "!! WinSCP.com が見つかりません。WinSCP をインストールするか deploy.config.ps1 で `$WinScpCom を指定してください。"
  exit 1
}

Write-Host ("WinSCP: " + $winscp)
Write-Host ("接続  : ftpes://" + $FtpUser + "@" + $FtpHost + $ProRemoteDir)
Write-Host ("対象  : pro\ 配下を再帰アップロード")

# 3) 認証情報を URL エンコード
$encUser = [uri]::EscapeDataString($FtpUser)
$encPass = [uri]::EscapeDataString($FtpPass)

# 4) WinSCP スクリプト生成（pro\ をローカルディレクトリにして再帰 put）
$lines = @()
$lines += 'option batch abort'
$lines += 'option confirm off'
$lines += ('open ftpes://' + $encUser + ':' + $encPass + '@' + $FtpHost + '/ -certificate="*"')
$lines += ('lcd "' + $proDir + '"')
# pro\ 配下を /joffice-pro/ へ同期（時刻基準。リモート削除はしない＝-delete 不使用）
$lines += ('synchronize remote -nopreservetime -filemask="|.git/; *.safe_write_prev" "' + $proDir + '" "' + $ProRemoteDir + '"')
$lines += 'close'
$lines += 'exit'
$scriptText = ($lines -join "`r`n") + "`r`n"

$tmp = Join-Path $env:TEMP ("joffice_pro_deploy_" + [guid]::NewGuid().ToString('N') + ".txt")
[System.IO.File]::WriteAllText($tmp, $scriptText, (New-Object System.Text.UTF8Encoding($true)))

# 5) 実行
$ErrorActionPreference = 'Continue'
try {
  & $winscp /ini=nul "/script=$tmp"
  $code = $LASTEXITCODE
} finally {
  Remove-Item -Force $tmp -ErrorAction SilentlyContinue
}

Write-Host ""
if ($code -eq 0) {
  Write-Host "OK: joffice-pro デプロイ完了"
  Write-Host "   初回は /joffice-pro/setup_admin.php で管理者作成 → 実行後に setup_admin.php を削除してください。"
} else {
  Write-Host ("!! デプロイ失敗 (WinSCP exit " + $code + ")。FTP情報・接続(FTPS/証明書)・配置先を確認してください。")
}
exit $code

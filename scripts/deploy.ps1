# sharoshi-worklog-mvp: レンタルサーバへの FTPS デプロイ (WinSCP 使用)
# 使い方:
#   1) scripts\deploy.config.sample.ps1 を scripts\deploy.config.ps1 にコピーして FTP情報を設定
#   2) 全Webファイルを配信:
#        powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
#      変更したファイルだけ配信:
#        powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Only dashboard.js,dashboard.css
param(
  [string[]]$Only
)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
Write-Host "== sharoshi-worklog-mvp deploy (FTPS / WinSCP) =="

# 1) 設定読み込み
$cfg = Join-Path $PSScriptRoot 'deploy.config.ps1'
if (-not (Test-Path $cfg)) {
  Write-Host "!! 設定ファイルがありません: $cfg"
  Write-Host "   scripts\deploy.config.sample.ps1 をコピーして deploy.config.ps1 を作成し、FTP情報を設定してください。"
  exit 1
}
. $cfg
if (-not $FtpHost -or -not $FtpUser -or -not $FtpPass -or -not $RemoteDir) {
  Write-Host "!! deploy.config.ps1 の FtpHost / FtpUser / FtpPass / RemoteDir をすべて設定してください。"
  exit 1
}

# 2) 配信対象（Webファイルのみ。gas/ docs/ scripts/ DEPLOY.md などは配信しない）
$webFiles = @(
  'index.html','worklog.html','worklog-month.html','staff.html','dashboard.html','data-edit.html','master.html','targets.html','analysis.html',
  'styles.css','worklog-month.css','staff.css','dashboard.css','data-edit.css','master.css','targets.css','analysis.css',
  'app.js','worklog-month.js','staff.js','dashboard.js','backend.js','config.js','data-edit.js','master.js','targets.js','analysis.js','allocation.js'
)
if ($Only) {
  # -File 経由だと "a,b" が1要素で渡るためカンマでも分割できるよう正規化
  $Only = $Only | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  $invalid = $Only | Where-Object { $webFiles -notcontains $_ }
  if ($invalid) { Write-Host ("!! 配信対象外の指定: " + ($invalid -join ', ')); exit 1 }
  $files = $Only
} else {
  $files = $webFiles
}
$missing = $files | Where-Object { -not (Test-Path (Join-Path $root $_)) }
if ($missing) { Write-Host ("!! ファイルが見つかりません: " + ($missing -join ', ')); exit 1 }

# 3) WinSCP.com を探す
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
  Write-Host "!! WinSCP.com が見つかりません。WinSCP をインストールするか、deploy.config.ps1 で `$WinScpCom にパスを指定してください。"
  exit 1
}

Write-Host ("WinSCP: " + $winscp)
Write-Host ("接続  : ftpes://" + $FtpUser + "@" + $FtpHost + $RemoteDir)
Write-Host ("対象  : " + ($files -join ', '))

# 4) 認証情報を URL エンコード（特殊文字対応）
$encUser = [uri]::EscapeDataString($FtpUser)
$encPass = [uri]::EscapeDataString($FtpPass)

# 5) WinSCP スクリプト生成（UTF-8 BOM で日本語のローカルパスに対応）
$lines = @()
$lines += 'option batch abort'
$lines += 'option confirm off'
$lines += ('open ftpes://' + $encUser + ':' + $encPass + '@' + $FtpHost + '/ -certificate="*"')
$lines += ('lcd "' + $root + '"')
$lines += ('cd "' + $RemoteDir + '"')
foreach ($f in $files) { $lines += ('put -nopreservetime "' + $f + '"') }
$lines += 'close'
$lines += 'exit'
$scriptText = ($lines -join "`r`n") + "`r`n"

$tmp = Join-Path $env:TEMP ("wklog_deploy_" + [guid]::NewGuid().ToString('N') + ".txt")
[System.IO.File]::WriteAllText($tmp, $scriptText, (New-Object System.Text.UTF8Encoding($true)))

# 6) 実行
$ErrorActionPreference = 'Continue'
try {
  & $winscp /ini=nul "/script=$tmp"
  $code = $LASTEXITCODE
} finally {
  Remove-Item -Force $tmp -ErrorAction SilentlyContinue
}

Write-Host ""
if ($code -eq 0) {
  Write-Host ("OK: デプロイ完了 (" + $files.Count + " ファイル)")
} else {
  Write-Host ("!! デプロイ失敗 (WinSCP exit " + $code + ")。FTP情報・RemoteDir・接続(FTPS/証明書)を確認してください。")
}
exit $code

# sharoshi-worklog-mvp: FTPS ディレクトリ一覧（RemoteDir 調査用）
# 使い方:
#   powershell -ExecutionPolicy Bypass -File scripts\ftp-ls.ps1            # ルート / を一覧
#   powershell -ExecutionPolicy Bypass -File scripts\ftp-ls.ps1 -Path /public_html
param(
  [string]$Path = "/"
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

$cfg = Join-Path $PSScriptRoot 'deploy.config.ps1'
if (-not (Test-Path $cfg)) { Write-Host "!! deploy.config.ps1 がありません。"; exit 1 }
. $cfg
if (-not $FtpHost -or -not $FtpUser -or -not $FtpPass) { Write-Host "!! FTP情報が未設定です。"; exit 1 }

# WinSCP.com を探す
$winscp = $null
if ($WinScpCom -and (Test-Path $WinScpCom)) { $winscp = $WinScpCom }
else {
  foreach ($c in @("$env:ProgramFiles\WinSCP\WinSCP.com","${env:ProgramFiles(x86)}\WinSCP\WinSCP.com","$env:LOCALAPPDATA\Programs\WinSCP\WinSCP.com")) {
    if ($c -and (Test-Path $c)) { $winscp = $c; break }
  }
  if (-not $winscp) { $cmd = Get-Command WinSCP.com -ErrorAction SilentlyContinue; if ($cmd) { $winscp = $cmd.Source } }
}
if (-not $winscp) { Write-Host "!! WinSCP.com が見つかりません。"; exit 1 }

$encUser = [uri]::EscapeDataString($FtpUser)
$encPass = [uri]::EscapeDataString($FtpPass)
Write-Host ("一覧: " + $Path)

$lines = @(
  'option batch abort',
  'option confirm off',
  ('open ftpes://' + $encUser + ':' + $encPass + '@' + $FtpHost + '/ -certificate="*"'),
  ('ls "' + $Path + '"'),
  'exit'
)
$scriptText = ($lines -join "`r`n") + "`r`n"
$tmp = Join-Path $env:TEMP ("wklog_ls_" + [guid]::NewGuid().ToString('N') + ".txt")
[System.IO.File]::WriteAllText($tmp, $scriptText, (New-Object System.Text.UTF8Encoding($true)))

$ErrorActionPreference = 'Continue'
try { & $winscp /ini=nul "/script=$tmp"; $code = $LASTEXITCODE }
finally { Remove-Item -Force $tmp -ErrorAction SilentlyContinue }
exit $code

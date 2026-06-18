# sharoshi-worklog-mvp: コミット＆プッシュ (Windows PowerShell 用)
# 使い方:
#   powershell -ExecutionPolicy Bypass -File scripts\git-sync.ps1 -Message "コミットメッセージ"
#   （-Message 省略時は日時入りの既定メッセージ）
# 前提: 先に git-init.ps1 / git-push-github.ps1 を実行済みであること。
param(
  [string]$Message
)
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
Write-Host "== git sync (commit & push) =="

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "!! git が見つかりません。"; exit 1
}
git rev-parse --is-inside-work-tree 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "!! gitリポジトリではありません。先に scripts\git-init.ps1 を実行してください。"; exit 1
}

# identity（未設定時のみ）
if (-not (git config user.email)) { git config user.email "adachi@h-linksystems.com" }
if (-not (git config user.name))  { git config user.name  "adachi" }

if (-not $Message) { $Message = "更新 " + (Get-Date -Format "yyyy-MM-dd HH:mm") }

git branch -M main

# ステージ＆コミット
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host "-- コミットする変更はありません"
} else {
  $tmp = Join-Path $env:TEMP ("wklog_msg_" + [guid]::NewGuid().ToString('N') + ".txt")
  [System.IO.File]::WriteAllText($tmp, $Message, (New-Object System.Text.UTF8Encoding($false)))
  git commit -F $tmp
  Remove-Item -Force $tmp -ErrorAction SilentlyContinue
}

# プッシュ（upstream を確実に設定）
Write-Host "-- push origin main"
git push -u origin main
$code = $LASTEXITCODE

Write-Host ""
if ($code -eq 0) {
  Write-Host "OK: プッシュ完了"
  git --no-pager log --oneline -1
} else {
  Write-Host "!! プッシュ失敗 (exit $code)。認証、または origin 未設定の可能性。"
  Write-Host "   origin 未設定なら先に scripts\git-push-github.ps1 を実行してください。"
}
exit $code

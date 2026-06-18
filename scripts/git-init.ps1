# sharoshi-worklog-mvp: git 初期化＋現状コミット (Windows PowerShell 用)
# 使い方:
#   cd "C:\Users\user\OneDrive\デスクトップ\HLSもろもろ\人事オフィス\sharoshi-worklog-mvp"
#   powershell -ExecutionPolicy Bypass -File scripts\git-init.ps1
# 何度実行しても安全。正常なリポジトリが既にあれば再初期化せず追記コミットのみ。

# リポジトリルート（このスクリプトの1つ上）へ移動
Set-Location (Split-Path $PSScriptRoot -Parent)
Write-Host "== sharoshi-worklog-mvp git init =="
Write-Host ("dir: " + (Get-Location))

# git の存在確認
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "!! git が見つかりません。Git for Windows をインストールしてください。"
  exit 1
}

# 1) サンドボックス作業の残骸を掃除
Remove-Item -Force -ErrorAction SilentlyContinue .\.gittest_*, .\.x_*
Get-ChildItem -Recurse -Force -Filter *.safe_write_prev -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue

# 2) 壊れた/作りかけの .git スタブを除去（有効なリポジトリでない場合のみ）
if (Test-Path .git) {
  git rev-parse --is-inside-work-tree 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "-- 壊れた .git スタブを削除します"
    Remove-Item -Recurse -Force .git
  }
}

# 3) 必要なら初期化
if (-not (Test-Path .git)) {
  Write-Host "-- git init"
  git init | Out-Null
}

# コミット用 identity（未設定のときだけローカルに設定）
if (-not (git config user.email)) { git config user.email "adachi@h-linksystems.com" }
if (-not (git config user.name))  { git config user.name  "adachi" }

# 4) ステージ＆コミット（メッセージは UTF-8 ファイル経由で文字化け回避）
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  $msg = "現状スナップショット: 工数×売上 生産性分析ツール MVP (案2改修前)"
  $tmp = Join-Path $env:TEMP "wklog_commit_msg.txt"
  [System.IO.File]::WriteAllText($tmp, $msg, (New-Object System.Text.UTF8Encoding($false)))
  git commit -F $tmp
  Remove-Item -Force $tmp -ErrorAction SilentlyContinue
} else {
  Write-Host "-- 変更なし（コミットなし）"
}

# 5) 検証: config.js が追跡対象外であること（トークン漏れ防止）
Write-Host ""
Write-Host "== verify =="
git ls-files --error-unmatch config.js 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Host "!! WARNING: config.js が追跡されています（トークンがコミットされる恐れ）"
  Write-Host "   対処: git rm --cached config.js  を実行してください"
} else {
  Write-Host "OK: config.js は追跡対象外"
}
git ls-files --error-unmatch config.sample.js 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Host "OK: config.sample.js は追跡対象" }

Write-Host ""
Write-Host "== result =="
git --no-pager log --oneline -1
$count = (git ls-files | Measure-Object -Line).Lines
Write-Host ("-- tracked files: " + $count + " 件")
git status --short
Write-Host ""
Write-Host "完了。"

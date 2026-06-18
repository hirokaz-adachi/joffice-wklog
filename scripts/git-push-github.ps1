# sharoshi-worklog-mvp: GitHub 連携（origin 設定＋push） Windows PowerShell 用
# 使い方:
#   cd "C:\Users\user\OneDrive\デスクトップ\HLSもろもろ\人事オフィス\sharoshi-worklog-mvp"
#   powershell -ExecutionPolicy Bypass -File scripts\git-push-github.ps1
# 前提: 先に scripts\git-init.ps1 を実行し、ローカルに1コミット以上あること。
# 何度実行しても安全（origin は add でなく set-url で更新）。

$RepoUrl = "https://github.com/hirokaz-adachi/joffice-wklog.git"

Set-Location (Split-Path $PSScriptRoot -Parent)
Write-Host "== GitHub 連携 =="
Write-Host ("dir : " + (Get-Location))
Write-Host ("repo: " + $RepoUrl)

# git の存在確認
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "!! git が見つかりません。Git for Windows をインストールしてください。"
  exit 1
}

# ローカルリポジトリ＆コミットの存在確認
git rev-parse --is-inside-work-tree 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "!! ここは git リポジトリではありません。先に scripts\git-init.ps1 を実行してください。"
  exit 1
}
git rev-parse HEAD 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "!! コミットがありません。先に scripts\git-init.ps1 を実行してください。"
  exit 1
}

# ブランチを main に統一
git branch -M main

# origin を設定（あれば URL 更新、なければ追加）
git remote get-url origin 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Host "-- origin を更新します"
  git remote set-url origin $RepoUrl
} else {
  Write-Host "-- origin を追加します"
  git remote add origin $RepoUrl
}

# push（初回は -u で upstream を設定）
Write-Host ""
Write-Host "-- push origin main（認証を求められたら GitHub にログインしてください）"
git push -u origin main
$pushExit = $LASTEXITCODE

Write-Host ""
Write-Host "== result =="
if ($pushExit -eq 0) {
  Write-Host "OK: push 完了"
  git remote -v
  git --no-pager log --oneline -1
} else {
  Write-Host "!! push に失敗しました (exit $pushExit)。よくある原因と対処:"
  Write-Host "   1) 認証エラー: GitHub のログイン（ブラウザ認証 or Personal Access Token）が必要です。"
  Write-Host "   2) リモートに既存コミットがある（README等で初期化済み）: 下記で取り込んでから再push。"
  Write-Host "        git pull --rebase origin main"
  Write-Host "        git push -u origin main"
  Write-Host "   3) リポジトリ URL/権限の確認: " $RepoUrl
}

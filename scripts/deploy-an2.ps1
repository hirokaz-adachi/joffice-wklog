# 案2 協調デプロイ（GAS反映 → setup()/rebuildDemo() 手動実行案内 → FTPS配信）
# 対話型。Windows / PowerShell 7 で、自分のターミナルから実行してください。
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-an2.ps1
# 前提: clasp ログイン済み（gas/.clasp.json あり）、scripts\deploy.config.ps1 設定済み。
#
# ※ 公開中デモ（tools.h-linksystems.com/joffice/）のGASスキーマを変更し、
#    rebuildDemo() でデモデータを作り直します（後戻り不可）。低トラフィック時に実施推奨。
param(
  [string]$DeploymentId = "AKfycbyisWQGRuGpUjw9CXmpzT9ojZXLp2eCxZm277IDxyPHksncl-Ru0E5ajeOGJMjiUBCH",
  [switch]$SkipFrontend
)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$gas = Join-Path $root "gas"

Write-Host "== 案2 協調デプロイ ==" -ForegroundColor Cyan
Write-Host "対象: 公開中デモのGAS（スキーマ変更＋デモデータ再構築）＋フロント配信"
$ans = Read-Host "続行しますか？ デモデータは rebuildDemo() で作り直されます (yes/no)"
if ($ans -ne "yes") { Write-Host "中止しました。"; exit 1 }

# --- 1) GASコードを push ---
Write-Host "`n[1/4] clasp push（gas/）..." -ForegroundColor Cyan
Push-Location $gas
try {
  & clasp push -f
  if ($LASTEXITCODE -ne 0) { throw "clasp push に失敗しました（exit $LASTEXITCODE）。clasp ログイン状態を確認してください。" }
} finally { Pop-Location }
Write-Host "  push 完了。" -ForegroundColor Green

# --- 2) Webアプリ・デプロイを最新コードへ更新（/exec URL 不変）---
Write-Host "`n[2/4] clasp deploy（既存デプロイを最新コードへ更新）..." -ForegroundColor Cyan
Push-Location $gas
try {
  & clasp deploy -i $DeploymentId -d ("an2 " + (Get-Date -Format "yyyy-MM-dd HH:mm"))
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  !! clasp deploy が失敗しました。エディタの[デプロイ]→[デプロイを管理]から" -ForegroundColor Yellow
    Write-Host "     既存デプロイを編集し『新バージョン』でデプロイしてください（/exec URLは不変）。" -ForegroundColor Yellow
  } else { Write-Host "  デプロイ更新 完了。" -ForegroundColor Green }
} finally { Pop-Location }

# --- 3) Apps Script エディタで setup() → rebuildDemo() を手動実行 ---
$scriptId = (Get-Content (Join-Path $gas ".clasp.json") -Raw | ConvertFrom-Json).scriptId
$editorUrl = "https://script.google.com/home/projects/$scriptId/edit"
Write-Host "`n[3/4] Apps Script エディタで関数を実行してください。" -ForegroundColor Cyan
Write-Host "  エディタを開きます: $editorUrl"
Start-Process $editorUrl
Write-Host "  手順: 関数選択 → (1) setup() を実行 → (2) rebuildDemo() を実行"
Write-Host "        （初回は承認ダイアログが出ます。許可してください）"
Read-Host "  setup() と rebuildDemo() の実行が完了したら Enter を押してください"

# --- 4) フロント配信（FTPS）---
if ($SkipFrontend) {
  Write-Host "`n[4/4] フロント配信はスキップ（-SkipFrontend）。" -ForegroundColor Yellow
} else {
  Write-Host "`n[4/4] フロント配信（FTPS・全Webファイル）..." -ForegroundColor Cyan
  & (Join-Path $PSScriptRoot "deploy.ps1")
}

Write-Host "`n== 完了 ==" -ForegroundColor Green
Write-Host "確認: https://tools.h-linksystems.com/joffice/ を強制リロード（Ctrl+F5）して、"
Write-Host "      ダッシュボードの 税抜売上(総)/役務売上/消費税 と詳細分析の指標切替を確認してください。"

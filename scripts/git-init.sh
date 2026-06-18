#!/usr/bin/env bash
# sharoshi-worklog-mvp: git 初期化＋現状コミット（Windows の Git Bash で実行）
# 使い方:  cd .../sharoshi-worklog-mvp && bash scripts/git-init.sh
# 何度実行しても安全。既に正常なリポジトリがあれば再初期化せず追記コミットのみ行う。
set -euo pipefail

# リポジトリルート（このスクリプトの1つ上）へ移動
cd "$(dirname "$0")/.."
echo "== sharoshi-worklog-mvp git init =="
echo "dir: $(pwd)"

# 1) サンドボックス作業の残骸を掃除（存在すれば）
rm -f .gittest_* .x_* 2>/dev/null || true
find . -name '*.safe_write_prev' -type f -delete 2>/dev/null || true

# 2) 壊れた/作りかけの .git スタブを除去（有効なリポジトリでない場合のみ）
if [ -d .git ] && ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "-- removing broken .git stub"
  rm -rf .git
fi

# 3) 必要なら初期化
if [ ! -d .git ]; then
  echo "-- git init"
  git init
fi

# コミット用の identity（未設定のときだけローカルに設定）
git config user.email >/dev/null 2>&1 || git config user.email "adachi@h-linksystems.com"
git config user.name  >/dev/null 2>&1 || git config user.name  "adachi"

# 4) ステージ＆コミット
git add -A
if git diff --cached --quiet; then
  echo "-- nothing to commit (作業ツリーに変更なし)"
else
  git commit -m "現状スナップショット: 工数×売上 生産性分析ツール MVP (案2改修前)"
fi

# 5) 検証: config.js が追跡対象外であること（トークン漏れ防止）
echo
echo "== verify =="
if git ls-files --error-unmatch config.js >/dev/null 2>&1; then
  echo "!! WARNING: config.js が追跡されています（トークンがコミットされる恐れ）"
  echo "   .gitignore を確認し、git rm --cached config.js を実行してください"
else
  echo "OK: config.js は追跡対象外"
fi
echo "-- config.sample.js:"
git ls-files --error-unmatch config.sample.js >/dev/null 2>&1 && echo "   tracked (OK)" || echo "   NOT tracked (確認)"

echo
echo "== result =="
git --no-pager log --oneline -1 || true
echo "-- tracked files: $(git ls-files | wc -l) 件"
git status --short
echo
echo "完了。"

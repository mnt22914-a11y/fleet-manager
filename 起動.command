#!/bin/zsh
# ダブルクリックで車両管理アプリを開く。
# 必要なら簡易サーバー(python3)を起動し、ブラウザで http://localhost:8080/ を開く。
cd "$(dirname "$0")"
PORT=8080
if ! lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  nohup python3 -m http.server $PORT >/dev/null 2>&1 &
  for i in 1 2 3 4 5 6 7 8 9 10; do
    lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && break
    sleep 0.3
  done
fi
open "http://localhost:$PORT/"

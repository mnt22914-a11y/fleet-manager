# 車両管理アプリ(fleet-manager)

配送会社の車両台帳・整備記録を管理する、ビルド不要の静的 PWA。構成と約束事は README.md を正とする。

## 方針
- フレームワークやビルドツールは使わない(家計簿アプリ ~/Projects/family-kakeibo と同じ流儀)
- 計算は js/logic.js の純粋関数に寄せ、node --test tests/*.test.mjs でテストする。画面(app.js)は HTML を組んでイベントを捌くだけ
- 保存は js/store.js を通す。画面から localStorage を直接触らない(将来 Supabase に差し替えるため)
- UI 文言は日本語。利用者は事務所の管理者(PC)なので、テーブルと一覧性を優先し、スマホは崩れなければよい
- 既存データの形を変えるときは store.js の normalize() で古い形を読めるようにする

- 車体の図は js/views2d.js(SVG の 5 面図)。3D は 2026-10-19 にいったんやめた(コードは git 履歴にある)
- 写真は js/photos.js(IndexedDB)。localStorage には ID だけ入れる

## 続きを始めるとき
- まず docs/進捗.md を読む(いまの状態、やりかけの作業、次の候補)
- 3D モデルの基準は reference/(三面図 4 枚と 3d-spec.md)

## 確認の仕方
- `python3 -m http.server 8080` で開き、設定 → サンプルデータを入れて全画面を目で見る
- `node --test tests/*.test.mjs` が通ること

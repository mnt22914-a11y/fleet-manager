# 車両管理アプリ(fleet-manager)

配送会社の車両台帳・整備記録を管理する、ビルド不要の静的 PWA。構成と約束事は README.md を正とする。

## 方針
- フレームワークやビルドツールは使わない(家計簿アプリ ~/Projects/family-kakeibo と同じ流儀)
- 計算は js/logic.js の純粋関数に寄せ、node --test tests/*.test.mjs でテストする。画面(app.js)は HTML を組んでイベントを捌くだけ
- 保存は js/store.js を通す。画面から localStorage を直接触らない(将来 Supabase に差し替えるため)
- UI 文言は日本語。利用者は事務所の管理者(PC)なので、テーブルと一覧性を優先し、スマホは崩れなければよい
- 既存データの形を変えるときは store.js の normalize() で古い形を読めるようにする

- 3D は Three.js r128(cdnjs)を index.html で読み、js/van3d.js で組み立てる。window.THREE が無ければ 2D 図に落ちる
- 写真は js/photos.js(IndexedDB)。localStorage には ID だけ入れる

## 確認の仕方
- `python3 -m http.server 8080` で開き、設定 → サンプルデータを入れて全画面を目で見る
- `node --test tests/*.test.mjs` が通ること

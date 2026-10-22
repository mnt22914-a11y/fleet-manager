# 家計簿アプリから写した参考コード(2026-10-22)

家計簿アプリ(family-kakeibo)は 2026-10-22 に削除した。車両管理の段階 2(Supabase 保存 + ログイン + GitHub Pages)で参考にする部分だけここに写してある。

- backend-supabase.js: Supabase の認証・CRUD・Realtime の書き方(保存層の差し替えの手本)
- backend-local.js: localStorage 版の保存層(同じ関数名で差し替える設計の例)
- config.js: 公開用の設定ファイルの形(URL と publishable キー)。中身は旧プロジェクトのもので、もう使えない
- schema.sql: RLS(行レベルセキュリティ)付きのテーブル定義の例
- cdp.mjs: ヘッドレス Chrome に接続して画面を確認する道具(scratchpad で使っていたものと同じ)

全体のバックアップは本人の指示で残していない。

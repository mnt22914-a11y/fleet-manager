// 共有(クラウド同期)の設定。
// 空のままだと「ローカルモード」(このブラウザだけに保存)で動きます。
// Supabase の Project Settings → API Keys にある値を貼り付けてください(docs/運用手順.md 参照)。
window.FLEET_CONFIG = {
  SUPABASE_URL: '',
  // 公開用のキー(publishable / anon)。秘密のキー(sb_secret_... / service_role)は絶対にここへ書かない
  SUPABASE_ANON_KEY: '',
};

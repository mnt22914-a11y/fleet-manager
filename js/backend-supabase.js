// クラウドモードの保存層: Supabase に保存し、ログインした人全員で同じデータを見る。
// テーブルは vehicles / records / issues / settings の 4 つ。どれも { id, data(jsonb), updated_at } の形で、
// 中身(data)はローカルモードと同じオブジェクトをそのまま入れる(列を増やさずに済むように)。
// 写真は Storage のバケット photos に `<id>.jpg` で置く(photos.js が使う)。

import { jaAuthError } from './logic.js';

const TABLES = ['vehicles', 'records', 'issues'];
const PAGE = 1000;

export async function createSupabaseBackend(url, anonKey) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(url, anonKey);
  let user = null;

  const check = ({ data, error }) => {
    if (error) throw jaAuthError(error);
    return data;
  };

  // ブラウザに「このサイトの保存データを勝手に消さないで」と頼む(ログイン状態が消えにくくなる)
  const keepStorage = () => navigator.storage?.persist?.().catch(() => {});

  async function listAll(table) {
    const out = [];
    for (let offset = 0; ; offset += PAGE) {
      const rows = check(await sb.from(table).select('id,data').order('id').range(offset, offset + PAGE - 1));
      out.push(...rows.map((r) => r.data));
      if (rows.length < PAGE) break;
    }
    return out;
  }

  async function deleteAll(table) {
    check(await sb.from(table).delete().neq('id', ''));
  }

  async function insertRows(table, items) {
    for (let i = 0; i < items.length; i += 500) {
      const chunk = items.slice(i, i + 500).map((x) => ({ id: x.id, data: x }));
      check(await sb.from(table).upsert(chunk));
    }
  }

  return {
    mode: 'cloud',
    client: sb,

    async init() {
      const { data } = await sb.auth.getSession();
      user = data.session?.user || null;
      if (!user) {
        // ログイン情報は残っているのに電波がなくて確認できないだけなら、ログイン画面には戻さない
        const remembered = Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
        return remembered && !navigator.onLine ? 'offline' : 'needs-auth';
      }
      keepStorage();
      return 'ready';
    },

    async loadAll() {
      try {
        const [vehicles, records, issues, settingsRows] = await Promise.all([
          listAll('vehicles'), listAll('records'), listAll('issues'),
          check(await sb.from('settings').select('id,data').eq('id', 'default')),
        ]);
        return { vehicles, records, issues, settings: settingsRows[0]?.data || {} };
      } catch (e) {
        if (!navigator.onLine) { const err = new Error('通信できません'); err.offline = true; throw err; }
        throw e;
      }
    },

    async upsert(table, items) {
      if (!items.length) return;
      await insertRows(table, items);
    },

    async remove(table, ids) {
      if (!ids.length) return;
      check(await sb.from(table).delete().in('id', ids));
    },

    async saveSettings(settings) {
      check(await sb.from('settings').upsert({ id: 'default', data: settings }));
    },

    // サンプル投入・バックアップ復元: 全員のデータを置き換える
    async replaceAll(state) {
      for (const t of TABLES) await deleteAll(t);
      for (const t of TABLES) await insertRows(t, state[t]);
      await this.saveSettings(state.settings);
    },

    async clearAll() {
      for (const t of TABLES) await deleteAll(t);
      check(await sb.from('settings').delete().eq('id', 'default'));
    },

    // 誰かがデータを変えたら呼ばれる。callback({ table, type: 'INSERT'|'UPDATE'|'DELETE', id, data })
    onChange(callback) {
      const channel = sb.channel('fleet-changes');
      for (const table of [...TABLES, 'settings']) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
          const row = payload.new?.id ? payload.new : payload.old;
          callback({ table, type: payload.eventType, id: row?.id, data: payload.new?.data || null });
        });
      }
      channel.subscribe();
    },

    auth: {
      userEmail() { return user?.email || ''; },
      async signIn(email, password) {
        const data = check(await sb.auth.signInWithPassword({ email, password }));
        user = data.user;
        keepStorage();
      },
      async signOut() {
        await sb.auth.signOut();
        user = null;
      },
      async resetPassword(email) {
        const redirectTo = location.origin + location.pathname;
        check(await sb.auth.resetPasswordForEmail(email, { redirectTo }));
      },
      async updatePassword(password) {
        check(await sb.auth.updateUser({ password }));
      },
      // event: 'SIGNED_IN' | 'SIGNED_OUT' | 'PASSWORD_RECOVERY' | 'TOKEN_REFRESHED' ...
      onChange(cb) {
        sb.auth.onAuthStateChange((event, session) => { user = session?.user || null; cb(event); });
      },
    },
  };
}

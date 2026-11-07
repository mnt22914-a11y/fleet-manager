// クラウドモードの保存層: Supabase に保存し、ログインした人全員で同じデータを見る。
// テーブルは vehicles / records / issues / settings の 4 つ。どれも { id, data(jsonb), updated_at } の形で、
// 中身(data)はローカルモードと同じオブジェクトをそのまま入れる(列を増やさずに済むように)。
// 写真は Storage のバケット photos に `<id>.jpg` で置く(photos.js が使う)。

import { jaAuthError } from './logic.js';

const TABLES = ['vehicles', 'records', 'issues'];
const PAGE = 1000;

export async function createSupabaseBackend(url, anonKey) {
  // 版は固定する(@2 だと新しい版が出るたびに中身が変わる。2.119.0 で Safari の起動が止まった)
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm');
  // lock: ブラウザのタブ間ロック(navigator.locks)を使わない。Safari で古いタブがロックを持ったままになり、
  // getSession() が返らず「読み込み中…」で止まることがあるため。1 社の小さなアプリなので、タブ内の順番だけ守れば十分
  let chain = Promise.resolve();
  const lock = (_name, _timeout, fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
  const sb = createClient(url, anonKey, { auth: { lock } });
  let user = null;
  let channel = null; // Realtime の購読(ログアウト → 再ログインで二重にならないよう 1 本だけ持つ)

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

  // 関数が無い(SQL をまだ Run していない)エラーか
  const missingFn = (error, name) => new RegExp(`${name}|PGRST202|42883`).test(`${error.code} ${error.message}`);

  async function isMember() {
    const { data, error } = await sb.rpc('is_member');
    if (error) {
      // 02_signup.sql をまだ Run していない(関数が無い)ときは、以前どおり「ログイン済み = 使える」
      if (missingFn(error, 'is_member')) return true;
      throw jaAuthError(error);
    }
    return data === true;
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
      return (await isMember()) ? 'ready' : 'needs-join';
    },

    // ---- メンバー管理(サインアップ制。招待コードを知っている人だけがメンバーになれる) ----
    async company() {
      const rows = check(await sb.from('company').select('invite_code').eq('id', 1));
      return rows[0] || null;
    },
    async members() {
      const r = await sb.from('members').select('user_id,email,name,created_at').order('created_at');
      // 03_invite_link.sql 前は name 列が無い
      if (r.error && /name/.test(r.error.message || '')) return check(await sb.from('members').select('user_id,email,created_at').order('created_at'));
      return check(r);
    },
    async removeMember(userId) {
      const { error } = await sb.rpc('remove_member', { p_user: userId });
      if (!error) return;
      if (!missingFn(error, 'remove_member')) throw jaAuthError(error);
      check(await sb.from('members').delete().eq('user_id', userId));
    },
    async regenerateInviteCode() {
      return check(await sb.rpc('regenerate_invite_code'));
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
      // 同じ名前だと古いチャンネルが返ってくるので、毎回別の名前にして古いほうは外す
      if (channel) { const old = channel; channel = null; sb.removeChannel(old).catch(() => {}); }
      channel = sb.channel(`fleet-changes-${Date.now()}`);
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
      /** 画面に出す名前(招待リンクで入った人は名前、メールで入った人はメール) */
      displayName() { return user?.user_metadata?.name || user?.email || ''; },
      /** 招待リンクで入った人(メール・パスワードが無いので、ログアウトすると戻れない) */
      isAnonymous() { return !!user?.is_anonymous; },
      /** 招待リンクから参加: まだログインしていなければ匿名でログインし、名前と招待コードでメンバーになる。 */
      async joinWithInvite(inviteCode, name) {
        const code = String(inviteCode || '').trim();
        name = String(name || '').trim();
        if (!name) throw new Error('名前を入れてください');
        if (!user) {
          const data = check(await sb.auth.signInAnonymously({ options: { data: { name } } }));
          user = data.user;
          keepStorage();
        } else if (user.is_anonymous && user.user_metadata?.name !== name) {
          const data = check(await sb.auth.updateUser({ data: { name } }));
          user = data.user;
        }
        const { error } = await sb.rpc('join_with_invite', { p_code: code, p_name: name });
        if (!error) return;
        if (!missingFn(error, 'join_with_invite')) throw jaAuthError(error);
        await this.join(code);
      },
      async signIn(email, password) {
        const data = check(await sb.auth.signInWithPassword({ email, password }));
        user = data.user;
        keepStorage();
      },
      async signOut() {
        await sb.auth.signOut();
        user = null;
      },
      /** 新規登録。'ok'(すぐ使える)か 'confirm-email'(確認メールを開いてからログイン)を返す。 */
      async signUp(email, password, inviteCode) {
        const data = check(await sb.auth.signUp({ email, password }));
        if (!data.session) return 'confirm-email';
        user = data.user;
        keepStorage();
        await this.join(inviteCode);
        return 'ok';
      },
      /** 招待コードでメンバーになる。 */
      async join(inviteCode) {
        check(await sb.rpc('join_company', { p_code: String(inviteCode || '').trim() }));
      },
      userId() { return user?.id || ''; },
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

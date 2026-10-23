// ローカルモードの保存層: このブラウザの localStorage に全体を 1 つの JSON で持つ。
// store.js からは cloud 版と同じ関数名で呼ばれる。どの関数も「全体を書き直す」だけ。

const KEY = 'fleet.v1';

export function createLocalBackend(getState) {
  const persist = () => localStorage.setItem(KEY, JSON.stringify(getState()));
  return {
    mode: 'local',
    auth: null,
    async init() { return 'ready'; },
    async loadAll() {
      try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
    },
    async upsert() { persist(); },
    async remove() { persist(); },
    async saveSettings() { persist(); },
    async replaceAll() { persist(); },
    async clearAll() { persist(); },
    onChange() {},
  };
}

-- 車両管理(fleet-manager)共有版: データベース定義
-- Supabase の「SQL Editor」に全文を貼り付けて Run してください(1 回だけ)。
-- ログインした人は全員が同じデータを読み書きできる(1 社で使う前提)。ログインしていない人は何も見えない。

-- ───────── テーブル(中身は jsonb。アプリ側の形をそのまま入れる) ─────────

create table if not exists public.vehicles (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.records (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.issues (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.settings (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- 更新時刻を自動で入れる
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['vehicles', 'records', 'issues', 'settings'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ───────── 権限(2026-10-30 以降は新しいテーブルに明示的な grant が必要) ─────────

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.vehicles, public.records, public.issues, public.settings to authenticated;
revoke all on public.vehicles, public.records, public.issues, public.settings from anon;

-- ───────── 行レベルセキュリティ: ログイン済みなら全部 OK、未ログインは何もできない ─────────

alter table public.vehicles enable row level security;
alter table public.records  enable row level security;
alter table public.issues   enable row level security;
alter table public.settings enable row level security;

do $$
declare t text;
begin
  foreach t in array array['vehicles', 'records', 'issues', 'settings'] loop
    execute format('drop policy if exists "members_all" on public.%I', t);
    execute format('create policy "members_all" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ───────── Realtime(他の人の変更をすぐ画面に反映する) ─────────

do $$
declare t text;
begin
  foreach t in array array['vehicles', 'records', 'issues', 'settings'] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ───────── 写真(Storage のバケット photos。非公開、ログイン済みだけ) ─────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "photos_select" on storage.objects;
drop policy if exists "photos_insert" on storage.objects;
drop policy if exists "photos_update" on storage.objects;
drop policy if exists "photos_delete" on storage.objects;
create policy "photos_select" on storage.objects for select to authenticated using (bucket_id = 'photos');
create policy "photos_insert" on storage.objects for insert to authenticated with check (bucket_id = 'photos');
create policy "photos_update" on storage.objects for update to authenticated using (bucket_id = 'photos');
create policy "photos_delete" on storage.objects for delete to authenticated using (bucket_id = 'photos');

-- 車両管理(fleet-manager): サインアップ制(招待コード方式)への変更
-- schema.sql を Run したあとに、SQL Editor でこの全文を貼り付けて Run してください(1 回だけ)。
-- 仕組み: 誰でもメール + パスワードで登録できるが、正しい招待コードで「メンバー」になるまで何も見えない。
-- 既にログインできる人(この SQL を Run する時点の利用者)は自動でメンバーになる。

-- ───────── 会社(1 行だけ)とメンバー ─────────

create table if not exists public.company (
  id int primary key default 1 check (id = 1),
  invite_code text not null default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  created_at timestamptz not null default now()
);
insert into public.company (id) values (1) on conflict (id) do nothing;

create table if not exists public.members (
  user_id uuid primary key references auth.users on delete cascade,
  email text not null default '',
  created_at timestamptz not null default now()
);
-- いまいる利用者はそのままメンバーに
insert into public.members (user_id, email)
  select id, coalesce(email, '') from auth.users
  on conflict (user_id) do nothing;

-- ───────── 判定関数(RLS の中から呼ぶ。security definer で members を直接見る) ─────────

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid());
$$;

-- 招待コードでメンバーになる(登録直後、またはログイン後に呼ぶ)
create or replace function public.join_company(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  if not exists (select 1 from public.company where upper(trim(invite_code)) = upper(trim(coalesce(p_code, '')))) then
    raise exception '招待コードが違います';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into public.members (user_id, email) values (auth.uid(), coalesce(v_email, ''))
    on conflict (user_id) do nothing;
end $$;

-- 招待コードを作り直す(メンバーなら誰でも。漏れたときに使う)
create or replace function public.regenerate_invite_code() returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.is_member() then raise exception 'メンバーだけが実行できます'; end if;
  v_code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
  update public.company set invite_code = v_code where id = 1;
  return v_code;
end $$;

-- ───────── 権限 ─────────

grant select on public.company to authenticated;
grant select, delete on public.members to authenticated;
revoke all on public.company, public.members from anon;
grant execute on function public.is_member() to authenticated;
grant execute on function public.join_company(text) to authenticated;
grant execute on function public.regenerate_invite_code() to authenticated;

-- ───────── RLS: 「ログイン済み」から「メンバー」に厳しくする ─────────

alter table public.company enable row level security;
alter table public.members enable row level security;
drop policy if exists "members_read_company" on public.company;
create policy "members_read_company" on public.company for select to authenticated using (public.is_member());
drop policy if exists "members_read_members" on public.members;
create policy "members_read_members" on public.members for select to authenticated using (public.is_member());
drop policy if exists "members_remove_others" on public.members;
create policy "members_remove_others" on public.members for delete to authenticated using (public.is_member() and user_id <> auth.uid());

do $$
declare t text;
begin
  foreach t in array array['vehicles', 'records', 'issues', 'settings'] loop
    execute format('drop policy if exists "members_all" on public.%I', t);
    execute format('create policy "members_all" on public.%I for all to authenticated using (public.is_member()) with check (public.is_member())', t);
  end loop;
end $$;

drop policy if exists "photos_select" on storage.objects;
drop policy if exists "photos_insert" on storage.objects;
drop policy if exists "photos_update" on storage.objects;
drop policy if exists "photos_delete" on storage.objects;
create policy "photos_select" on storage.objects for select to authenticated using (bucket_id = 'photos' and public.is_member());
create policy "photos_insert" on storage.objects for insert to authenticated with check (bucket_id = 'photos' and public.is_member());
create policy "photos_update" on storage.objects for update to authenticated using (bucket_id = 'photos' and public.is_member());
create policy "photos_delete" on storage.objects for delete to authenticated using (bucket_id = 'photos' and public.is_member());

-- いまの招待コード(登録する人に伝える。アプリの設定 → アカウントにも出る)
select invite_code from public.company;

-- 車両管理(fleet-manager): 招待リンクだけで参加できるようにする(メール・パスワード不要)
-- 02_signup.sql を Run したあとに、SQL Editor でこの全文を貼り付けて Run してください(1 回だけ。何度 Run しても大丈夫)。
-- あわせて Authentication → Sign In / Providers で「Allow anonymous sign-ins」を ON にする。
-- 仕組み: 招待リンク(…/?invite=コード)を開く → 名前を入れる → 匿名ログイン + 招待コードでメンバーになる。
-- 参加はその端末・ブラウザ単位。機種変更などで入れなくなったら、もう一度招待リンクから参加する(古い分は設定で外す)。

-- メンバーに名前を持たせる(メールが無い人の表示用)
alter table public.members add column if not exists name text not null default '';

-- 招待コード + 名前でメンバーになる(参加済みなら名前だけ更新)
create or replace function public.join_with_invite(p_code text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text; v_name text := left(trim(coalesce(p_name, '')), 40);
begin
  if auth.uid() is null then raise exception 'ログインしてください'; end if;
  if v_name = '' then raise exception '名前を入れてください'; end if;
  if not exists (select 1 from public.company where upper(trim(invite_code)) = upper(trim(coalesce(p_code, '')))) then
    raise exception '招待リンクが古いか、間違っています。管理者に新しいリンクをもらってください';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into public.members (user_id, email, name) values (auth.uid(), coalesce(v_email, ''), v_name)
    on conflict (user_id) do update set name = excluded.name;
end $$;

-- メンバーを外す。招待リンクで入った人(匿名)は、アカウントごと消す(Users に残さない)
create or replace function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception 'メンバーだけが実行できます'; end if;
  if p_user = auth.uid() then raise exception '自分は外せません'; end if;
  delete from public.members where user_id = p_user;
  delete from auth.users where id = p_user and is_anonymous;
end $$;

grant execute on function public.join_with_invite(text, text) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;

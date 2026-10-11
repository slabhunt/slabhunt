-- Player characters (retro mode). Ids match CHARACTERS in src/lib/hunterSprite.ts and are permanent.
-- 0-5 are free for everyone. Ids from 100 up are reserved for a future character mint and will need a verified wallet
-- holding that NFT (checked server-side here before it is allowed).
alter table public.profiles add column if not exists avatar smallint not null default 0;

create or replace function public.set_avatar(p_avatar int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('error', 'signed_out'); end if;
  if p_avatar is null or p_avatar < 0 or p_avatar > 5 then return jsonb_build_object('error', 'locked'); end if;
  update profiles set avatar = p_avatar where id = auth.uid();
  return jsonb_build_object('ok', true, 'avatar', p_avatar);
end $$;
revoke execute on function public.set_avatar(int) from public, anon;
grant execute on function public.set_avatar(int) to authenticated;

-- Security hardening from the Supabase advisor review.
alter function public.distance_m(float8, float8, float8, float8) set search_path = '';
revoke execute on function public.handle_new_user() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- Run the fairdraw function every minute. It freezes ended draws, opens weekly draws, commits to Solana,
-- settles with drand, and once an hour credits holder rewards. The secret header never leaves the database.
create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'vaulthunt-fairdraw') then
    perform cron.unschedule('vaulthunt-fairdraw');
  end if;
end $$;

select cron.schedule('vaulthunt-fairdraw', '* * * * *', $job$
  select net.http_post(
    url := 'https://naghdnhloupdnsmuhqws.supabase.co/functions/v1/fairdraw',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 55000)
$job$);

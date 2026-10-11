-- The $SLAB pool opens at 2026-10-12 00:00 UTC (8 PM New York, Oct 11), read from the pool's activation point on-chain.
-- The launch countdown moves there. (Applied by hand on Oct 11; pre-launch mode is switched off at 8 PM from /admin.)
update public.game_config set launch_at = '2026-10-12 00:00:00+00' where id;

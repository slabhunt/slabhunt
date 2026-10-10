-- Launch ramp: Season 1 = 3 days, Season 2 = 7 days, Season 3 = 14 days, then 30-day seasons for 12 months.
update public.seasons set ends_at = starts_at + interval '3 days' where id = 1;
insert into public.seasons (name, starts_at, ends_at, supply, mint_price_tokens)
select 'Season ' || n,
       s1.ends_at + (sum_before || ' days')::interval,
       s1.ends_at + ((sum_before + len) || ' days')::interval,
       111, 5000
from public.seasons s1,
     (values (2, 7, 0), (3, 14, 7),
             (4, 30, 21), (5, 30, 51), (6, 30, 81), (7, 30, 111), (8, 30, 141), (9, 30, 171),
             (10, 30, 201), (11, 30, 231), (12, 30, 261), (13, 30, 291), (14, 30, 321), (15, 30, 351)) v(n, len, sum_before)
where s1.id = 1;
update public.seasons set name = 'Season 2: Night Market' where name = 'Season 2';
update public.seasons set name = 'Season 3: Tidal Rush' where name = 'Season 3';
update public.profiles set pass_until = (select ends_at from public.seasons where id = 1)
 where pass_until > (select ends_at from public.seasons where id = 1);

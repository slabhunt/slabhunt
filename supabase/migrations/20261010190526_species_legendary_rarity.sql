-- 151 creatures unlocking by season, a Legendary rarity, and coin-bid mint auctions for creature NFTs.

---------------------------------------------------------------------------
-- Creatures
---------------------------------------------------------------------------
alter table public.species drop constraint if exists species_rarity_check;
alter table public.species add constraint species_rarity_check check (rarity in ('c','u','r','l'));

-- $SLAB is live on mainnet: point the game at the real mint. Applied by hand on Oct 11, 2026.
-- Purchases with $SLAB (power-ups, draw tickets, pass mint) stay switched off until legal sign-off; this only makes
-- holder checks, the proof page and draw memos use mainnet. The fair-draw memo wallet (FAIRDRAW_KEYPAIR) needs a
-- little mainnet SOL before the first draw closes, or commitments will retry until it has some.
update public.game_config
   set token_mint = 'B8FCj8MPSzLG21yxoBff3jdZmQSZDMt8WCVZTkFUMnEQ', token_cluster = 'mainnet-beta'
 where id;

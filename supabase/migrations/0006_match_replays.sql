-- Find My Mines — match replays, for game review.
--
-- How to apply: paste this whole file into the Supabase SQL editor and run it
-- once. Needs 0001 first (the matches table). Every statement is idempotent, so
-- running it again is harmless.
--
-- A finished match is saved with its replay: where every mine was and the
-- order the cells were opened in, by which seat. The review page plays a game
-- back from it (the board at each move, the chance of every covered slot, how
-- well each move was chosen), and the coach answers from it.
--
--   replay      jsonb. { v, rows, cols, mineCount, mines[], seats[], moves[] },
--               written by the game server. Null for matches saved before this
--               migration and for any the server could not build one for.
--   has_replay  generated from `replay`, so the game log and the profile pages
--               can show a Review button without downloading a replay per row.
--
-- Security posture:
--   * Matches are already publicly readable (0001's select policy), so a
--     finished game's mines and moves are public too, like its scores. That is
--     fine: the replay is only ever written once the match is over, by the
--     game server, so it can never help anyone in a game that is being played.
--   * Nothing here widens who can write. Browsers have no insert, update or
--     delete grant on `matches` (0001 grants select only), so only the game
--     server's service role writes a replay.
--   * The size check keeps one row from growing without bound: the biggest
--     board (16 x 16, ~250 moves) is a few kilobytes.
--
-- Without this migration the game still works: matches are saved without a
-- replay (the server retries its insert without the column), and the game log
-- shows "No replay saved". A game just played can still be reviewed from the
-- server's and the browser's memory.

alter table public.matches add column if not exists replay jsonb;

-- A replay is small. 100 kB is far past any real one and well under a row's limits.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'matches_replay_size' and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_replay_size
      check (replay is null or pg_column_size(replay) < 100000);
  end if;
end
$$;

-- True when a replay was saved. Stored, so lists can filter and show it for free.
alter table public.matches
  add column if not exists has_replay boolean generated always as (replay is not null) stored;

-- Reads keep working with the existing public select policy and grant (0001);
-- both cover new columns. Nothing to add for them here.

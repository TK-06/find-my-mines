-- Find My Mines — accounts, match history and Elo.
--
-- Security posture:
--   * RLS is on for every table in `public`.
--   * Reads are public (the leaderboard and match history are meant to be seen).
--   * ALL writes come from the game server using the service-role key, which
--     bypasses RLS. No client-side write policy exists, so a browser cannot
--     award itself rating no matter what it sends.

-- ── private schema for privileged helpers ───────────────────────────────────
-- A SECURITY DEFINER function in `public` is callable by anon/authenticated by
-- default, so anything privileged lives here instead.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ── profiles ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text not null unique check (char_length(username) between 2 and 20),
  elo           integer not null default 800,
  games_played  integer not null default 0,
  wins          integer not null default 0,
  losses        integer not null default 0,
  draws         integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- The leaderboard needs to be readable by everyone, signed in or not.
drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable"
  on public.profiles for select
  to anon, authenticated
  using (true);

-- A user may rename themselves and nothing else. USING and WITH CHECK are both
-- required: without WITH CHECK a user could reassign the row to someone else.
-- Rating columns are protected by the trigger below, not by this policy.
drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ── stop clients editing their own rating ───────────────────────────────────
-- The update policy above would otherwise let a signed-in user set elo = 9999.
create or replace function private.protect_rating_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- service_role writes ratings legitimately; everyone else is frozen.
  if current_setting('request.jwt.claims', true)::jsonb ->> 'role'
     is distinct from 'service_role' then
    new.elo          := old.elo;
    new.games_played := old.games_played;
    new.wins         := old.wins;
    new.losses       := old.losses;
    new.draws        := old.draws;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_protect_rating on public.profiles;
create trigger profiles_protect_rating
  before update on public.profiles
  for each row execute function private.protect_rating_columns();

-- ── create a profile for every new account ──────────────────────────────────
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate text;
begin
  candidate := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
    split_part(new.email, '@', 1),
    'player'
  );
  candidate := left(regexp_replace(candidate, '[^a-zA-Z0-9_ -]', '', 'g'), 20);
  if char_length(candidate) < 2 then
    candidate := 'player';
  end if;

  -- Usernames are unique; suffix until one sticks.
  while exists (select 1 from public.profiles p where p.username = candidate) loop
    candidate := left(candidate, 14) || '_' || substr(gen_random_uuid()::text, 1, 4);
  end loop;

  insert into public.profiles (id, username) values (new.id, candidate);
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ── matches ─────────────────────────────────────────────────────────────────
create table if not exists public.matches (
  id                uuid primary key default gen_random_uuid(),
  room_id           text not null,
  mode              text not null check (mode in ('casual', 'ranked')),
  config            jsonb not null,
  winner_profile_id uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now()
);

alter table public.matches enable row level security;

drop policy if exists "matches are publicly readable" on public.matches;
create policy "matches are publicly readable"
  on public.matches for select
  to anon, authenticated
  using (true);

-- ── match_players ───────────────────────────────────────────────────────────
-- profile_id is nullable on purpose: guests have no account but are still
-- recorded, so a match's history is complete.
create table if not exists public.match_players (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null references public.matches (id) on delete cascade,
  profile_id   uuid references public.profiles (id) on delete set null,
  display_name text not null,
  is_guest     boolean not null default false,
  score        integer not null default 0,
  placement    integer not null,
  elo_before   integer not null,
  elo_after    integer not null,
  elo_delta    integer not null default 0,
  outcome      text not null check (outcome in ('win', 'loss', 'draw'))
);

alter table public.match_players enable row level security;

drop policy if exists "match players are publicly readable" on public.match_players;
create policy "match players are publicly readable"
  on public.match_players for select
  to anon, authenticated
  using (true);

create index if not exists match_players_match_idx on public.match_players (match_id);
create index if not exists match_players_profile_idx on public.match_players (profile_id);
create index if not exists profiles_elo_idx on public.profiles (elo desc);

-- ── applying a rated result ─────────────────────────────────────────────────
-- Called by the game server only. Execute is revoked from every public role.
create or replace function public.apply_match_result(
  p_profile_id uuid,
  p_elo_after  integer,
  p_outcome    text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.profiles
     set elo          = p_elo_after,
         games_played = games_played + 1,
         wins         = wins   + (case when p_outcome = 'win'  then 1 else 0 end),
         losses       = losses + (case when p_outcome = 'loss' then 1 else 0 end),
         draws        = draws  + (case when p_outcome = 'draw' then 1 else 0 end)
   where id = p_profile_id;
end;
$$;

revoke all on function public.apply_match_result(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.apply_match_result(uuid, integer, text) to service_role;

-- ── expose reads through the Data API ───────────────────────────────────────
-- RLS controls which rows are visible; these grants control whether the table
-- is reachable at all. Reads only — writes stay with service_role.
grant select on public.profiles, public.matches, public.match_players to anon, authenticated;
grant update (username) on public.profiles to authenticated;

-- ── public leaderboard view ─────────────────────────────────────────────────
-- security_invoker so the view respects the caller's RLS rather than the
-- creator's; without it a view silently bypasses row-level security.
create or replace view public.leaderboard
with (security_invoker = true) as
  select
    id,
    username,
    elo,
    games_played,
    wins,
    losses,
    draws,
    rank() over (order by elo desc, wins desc) as rank
  from public.profiles
  where games_played > 0;

grant select on public.leaderboard to anon, authenticated;

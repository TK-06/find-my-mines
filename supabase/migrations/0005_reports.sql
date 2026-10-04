-- Find My Mines — player reports.
--
-- How to apply: paste this whole file into the Supabase SQL editor and run it
-- once. Every statement is idempotent, so running it again is harmless.
--
-- A report is sent from the Online now list (guests may report too) and goes
-- through the game server, which fills in who sent it and about whom from its
-- own records of both connections: account id, the guest cookie's random id,
-- the tab's session id and the IP address. Admins read reports on /admin.
--
-- Security posture:
--   * RLS is on with no policies, and anon / authenticated have no grants: no
--     browser can read or write this table. Only the game server's service
--     role, which bypasses RLS, touches it.
--   * Reports hold personal data (IP addresses, ids), so they are deleted after
--     90 days; the game server runs that delete at start-up and once a day.
--     The privacy page says the same.
--
-- Without this table the game still works: reports reach the console from the
-- server's memory and are lost on a restart.

create table if not exists public.reports (
  id          uuid primary key,
  created_at  timestamptz not null default now(),
  reason      text not null
                check (reason in ('offensive-name', 'harassment', 'cheating', 'spam', 'other')),
  details     text not null default '' check (char_length(details) <= 300),
  room_id     text,
  status      text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  handled_at  timestamptz,
  -- {nickname, profileId, isGuest, guestId, sessionId, address} as the server saw them;
  -- the target also carries the connection id it had (for kick / ban while it lasts).
  reporter    jsonb not null,
  target      jsonb not null
);

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

create index if not exists reports_created_at_idx on public.reports (created_at desc);

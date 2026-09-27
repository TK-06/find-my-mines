-- Find My Mines — admin accounts.
--
-- Who may open the server console (/admin) from another machine. The server
-- machine itself is always allowed without an account, so the graded Reset
-- button still works when this database is unreachable.
--
-- Security posture:
--   * Only the game server reads this table, with the service-role key.
--   * RLS is on and NO policy exists, and every grant is revoked from anon and
--     authenticated. A browser cannot read who the admins are, and cannot add
--     itself — not even a signed-in user.
--   * Deliberately not a column on `profiles`: profiles are publicly readable,
--     which would publish the admin list.

create table if not exists public.admins (
  profile_id  uuid primary key references public.profiles (id) on delete cascade,
  note        text,
  created_at  timestamptz not null default now()
);

alter table public.admins enable row level security;

revoke all on public.admins from anon, authenticated;

-- To make an account an admin, run this in the Supabase SQL editor with the
-- account's username:
--
--   insert into public.admins (profile_id, note)
--   select id, 'project owner' from public.profiles where username = 'YourUsername';
--
-- To remove one:
--
--   delete from public.admins
--   where profile_id = (select id from public.profiles where username = 'YourUsername');

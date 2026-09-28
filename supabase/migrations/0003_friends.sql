-- Find My Mines — friends.
--
-- How to apply: paste this whole file into the Supabase SQL editor and run it
-- once. Needs 0001 first (profiles, the private schema). Every statement is
-- idempotent, so running it again is harmless.
--
-- A friendship is one row per pair of accounts: the requester asks, the
-- addressee accepts. Declining, cancelling and unfriending all delete the row.
--
-- Security posture:
--   * RLS is on. A friendship is visible only to the two people in it.
--   * Unlike 0001, browsers write here directly with their own session, so
--     every write is fenced three ways — policy, column grant, trigger:
--       - insert: only as the requester, only 'pending', never to yourself.
--         Only the two id columns are insertable; status and timestamps take
--         their defaults.
--       - update: only the addressee, only pending → accepted. Only `status`
--         is updatable, so neither person can be swapped out; the trigger
--         refuses any other transition and stamps accepted_at itself.
--       - delete: either person.
--   * anon gets nothing: a signed-out visitor cannot see who is friends with
--     whom.
--   * The game server reads with the service role to check a friendship before
--     it relays an invite — a client saying "we are friends" is never enough.

-- ── friendships ─────────────────────────────────────────────────────────────
create table if not exists public.friendships (
  requester_id  uuid not null references public.profiles (id) on delete cascade,
  addressee_id  uuid not null references public.profiles (id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  primary key (requester_id, addressee_id),
  constraint friendships_not_self check (requester_id <> addressee_id)
);

-- One row per pair, whoever asked: without this, A→B and B→A could both
-- exist and the two people would disagree about whether they are friends.
create unique index if not exists friendships_pair_idx
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

-- The primary key already serves lookups by requester; this serves "who asked me".
create index if not exists friendships_addressee_idx on public.friendships (addressee_id);

alter table public.friendships enable row level security;

drop policy if exists "friendships are visible to both people" on public.friendships;
create policy "friendships are visible to both people"
  on public.friendships for select
  to authenticated
  using ((select auth.uid()) = requester_id or (select auth.uid()) = addressee_id);

drop policy if exists "users send friend requests as themselves" on public.friendships;
create policy "users send friend requests as themselves"
  on public.friendships for insert
  to authenticated
  with check ((select auth.uid()) = requester_id and status = 'pending');

-- USING picks the rows the addressee may touch (requests still waiting on
-- them); WITH CHECK says what they may turn them into (accepted, nothing else).
drop policy if exists "the addressee accepts a request" on public.friendships;
create policy "the addressee accepts a request"
  on public.friendships for update
  to authenticated
  using ((select auth.uid()) = addressee_id and status = 'pending')
  with check ((select auth.uid()) = addressee_id and status = 'accepted');

drop policy if exists "either person removes a friendship" on public.friendships;
create policy "either person removes a friendship"
  on public.friendships for delete
  to authenticated
  using ((select auth.uid()) = requester_id or (select auth.uid()) = addressee_id);

-- ── only pending → accepted, and the server's clock says when ───────────────
-- The column grant below already stops the ids being rewritten; this stops
-- any other status change (accepted back to pending, say) whoever attempts it,
-- and keeps accepted_at honest.
create or replace function private.guard_friendship_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.requester_id is distinct from old.requester_id
     or new.addressee_id is distinct from old.addressee_id then
    raise exception 'a friendship''s two people cannot be changed';
  end if;

  if not (old.status = 'pending' and new.status = 'accepted') then
    raise exception 'a friend request can only go from pending to accepted';
  end if;

  new.created_at  := old.created_at;
  new.accepted_at := now();
  return new;
end;
$$;

drop trigger if exists friendships_guard_update on public.friendships;
create trigger friendships_guard_update
  before update on public.friendships
  for each row execute function private.guard_friendship_update();

-- ── grants ──────────────────────────────────────────────────────────────────
-- RLS decides which rows; these decide which operations and columns at all.
revoke all on public.friendships from anon, authenticated;
grant select, delete on public.friendships to authenticated;
grant insert (requester_id, addressee_id) on public.friendships to authenticated;
grant update (status) on public.friendships to authenticated;

-- The game server's friendship check before relaying an invite.
grant select on public.friendships to service_role;

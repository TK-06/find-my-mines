-- Find My Mines — profile pictures.
--
-- How to apply: paste this whole file into the Supabase SQL editor and run it
-- once. Needs 0001 first (profiles, the leaderboard view). Every statement is
-- idempotent, so running it again is harmless — and re-running it puts the
-- bucket's limits back if someone loosened them in the dashboard.
--
-- A picture is one file in the public `avatars` bucket, inside a folder named
-- after its owner's account id: avatars/<user id>/<time>.webp. The profile row
-- keeps only that path, never a full address, so a row can only ever point at
-- a file in the owner's own folder.
--
-- Security posture:
--   * Pictures are public on purpose: anyone who has the address can load one,
--     the same as a username. The browser writes here directly with its own
--     session, so every write is fenced:
--       - profiles.avatar_path: the only new column a user may update (column
--         grant), only on their own row (0001's update policy), and only to
--         null or a simple file name inside their own folder (CHECK below).
--         0001's rating trigger still freezes every rating column; it leaves
--         this one alone.
--       - storage: a signed-in user may add, replace, list or delete objects
--         only when the first folder of the object's name is their own
--         auth.uid(). Nobody can touch anyone else's picture.
--       - the bucket takes at most 2 MB, and only WebP, PNG or JPEG. No SVG:
--         an SVG can carry script.
--   * anon may not write or list anything. Loading a picture goes through the
--     bucket's public address, which needs no policy.
--   * Removing a picture clears the column and deletes the file.

-- ── the column ──────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists avatar_path text;

-- Null, or <own id>/<plain name>.<webp|jpg|jpeg|png>. The same rule as
-- isOwnAvatarPath() in packages/shared/src/avatar.ts — keep the two in step.
alter table public.profiles drop constraint if exists profiles_avatar_path_own_folder;
alter table public.profiles add constraint profiles_avatar_path_own_folder check (
  avatar_path is null
  or (
    left(avatar_path, char_length(id::text) + 1) = id::text || '/'
    and position('..' in avatar_path) = 0
    and substr(avatar_path, char_length(id::text) + 2) ~ '^[A-Za-z0-9_-]{1,64}\.(webp|jpg|jpeg|png)$'
  )
);

-- 0001 lets a user update only `username`; this adds the picture and nothing
-- else. Reads need no change: 0001 grants select on the whole table.
grant update (avatar_path) on public.profiles to authenticated;

-- ── the bucket ──────────────────────────────────────────────────────────────
-- On conflict the limits are written again rather than skipped, so a bucket
-- made by hand in the dashboard still ends up public, small and image-only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── who may write which files ───────────────────────────────────────────────
-- storage.foldername('<uid>/123.webp') is {'<uid>'}; its first element is the
-- owner's folder. Removing a file also needs SELECT on it, so owners may see
-- their own folder — and only their own; nobody can list everyone's pictures.
drop policy if exists "avatars: owners see their own folder" on storage.objects;
create policy "avatars: owners see their own folder"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatars: owners upload into their own folder" on storage.objects;
create policy "avatars: owners upload into their own folder"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- USING picks the files they may touch; WITH CHECK stops them moving one out
-- of their folder, or into someone else's.
drop policy if exists "avatars: owners replace their own files" on storage.objects;
create policy "avatars: owners replace their own files"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatars: owners delete their own files" on storage.objects;
create policy "avatars: owners delete their own files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── leaderboard view, now with pictures ─────────────────────────────────────
-- Same as 0001 with avatar_path added at the end (create or replace may only
-- append columns). Still security_invoker, so it keeps respecting the
-- caller's row-level security, and still readable by everyone.
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
    rank() over (order by elo desc, wins desc) as rank,
    avatar_path
  from public.profiles
  where games_played > 0;

grant select on public.leaderboard to anon, authenticated;

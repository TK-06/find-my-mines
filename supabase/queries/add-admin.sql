-- Make an account a server-console admin (/admin from any machine).
--
-- Paste into Supabase → SQL Editor and press Run. Not a migration: nothing runs
-- this automatically. Safe to run twice — an existing admin is left as is.
--
-- To add someone else, change the username (the `username` column of
-- public.profiles, shown on their profile page) and the note.

insert into public.admins (profile_id, note)
select id, 'Chain — teammate'
from public.profiles
where username = 'chainpong'
on conflict (profile_id) do nothing;

-- Check: everyone who is an admin now. Chain should be listed. An empty result
-- for him means the username above did not match any account.
select p.username, a.note, a.created_at
from public.admins a
join public.profiles p on p.id = a.profile_id
order by a.created_at;

-- To remove an admin later, run this on its own:
--
--   delete from public.admins
--   where profile_id = (select id from public.profiles where username = 'chainpong');

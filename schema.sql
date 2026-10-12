-- Run this in Supabase SQL Editor after creating both users in Authentication → Users.
-- IMPORTANT: Replace the two UUID placeholders at the bottom with the actual Auth user UUIDs.
create extension if not exists pgcrypto;

create table if not exists public.allowed_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 5000),
  photo_path text,
  reply_to uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint message_has_content check (char_length(trim(body)) > 0 or photo_path is not null),
  constraint sender_not_recipient check (sender_id <> recipient_id)
);
create index if not exists messages_created_at_idx on public.messages(created_at);
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 180),
  due_at timestamptz not null,
  done boolean not null default false,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reminder_two_people check (creator_id <> recipient_id)
);
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.allowed_users enable row level security;
alter table public.messages enable row level security;
alter table public.reminders enable row level security;
alter table public.push_subscriptions enable row level security;
-- The two users can see the allowlist, but only admins/service role should modify it.
create policy "authenticated users can view allowlist" on public.allowed_users for select to authenticated using (true);
create policy "approved users read shared messages" on public.messages for select to authenticated using (exists(select 1 from public.allowed_users a where a.user_id=auth.uid()) and sender_id in (select user_id from public.allowed_users) and recipient_id in (select user_id from public.allowed_users));
create policy "approved users send as self" on public.messages for insert to authenticated with check (sender_id=auth.uid() and exists(select 1 from public.allowed_users a where a.user_id=auth.uid()) and recipient_id in (select user_id from public.allowed_users where user_id<>auth.uid()));
create policy "approved users view shared reminders" on public.reminders for select to authenticated using (exists(select 1 from public.allowed_users a where a.user_id=auth.uid()) and creator_id in (select user_id from public.allowed_users) and recipient_id in (select user_id from public.allowed_users));
create policy "approved users create shared reminders" on public.reminders for insert to authenticated with check (creator_id=auth.uid() and exists(select 1 from public.allowed_users a where a.user_id=auth.uid()) and recipient_id in (select user_id from public.allowed_users where user_id<>auth.uid()));
create policy "approved users update shared reminders" on public.reminders for update to authenticated using (exists(select 1 from public.allowed_users a where a.user_id=auth.uid()) and creator_id in (select user_id from public.allowed_users) and recipient_id in (select user_id from public.allowed_users)) with check (exists(select 1 from public.allowed_users a where a.user_id=auth.uid()));
create policy "users manage own push subscriptions" on public.push_subscriptions for all to authenticated using (user_id=auth.uid() and exists(select 1 from public.allowed_users a where a.user_id=auth.uid())) with check (user_id=auth.uid() and exists(select 1 from public.allowed_users a where a.user_id=auth.uid()));

-- Private photos/snaps bucket. Upload/read only under an approved user's UUID folder.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('private-snaps','private-snaps',false,10485760,array['image/jpeg','image/png','image/webp','image/gif','image/heic'])
on conflict (id) do update set public=false, file_size_limit=10485760;
create policy "approved users upload private snaps" on storage.objects for insert to authenticated with check (bucket_id='private-snaps' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.allowed_users a where a.user_id=auth.uid()));
create policy "approved users read private snaps" on storage.objects for select to authenticated using (bucket_id='private-snaps' and exists(select 1 from public.allowed_users a where a.user_id=auth.uid()));
create policy "owners delete own snaps" on storage.objects for delete to authenticated using (bucket_id='private-snaps' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.allowed_users a where a.user_id=auth.uid()));

-- Realtime sync. If this errors because a table is already in the publication, skip that line.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.reminders;

-- After creating the two users in Authentication → Users, insert their IDs:
-- insert into public.allowed_users(user_id) values
-- ('REPLACE_WITH_FIRST_AUTH_USER_UUID'), ('REPLACE_WITH_SECOND_AUTH_USER_UUID');

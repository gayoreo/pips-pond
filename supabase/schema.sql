-- Pip's Pond database. Paste all of this into Supabase → SQL Editor → New query → Run.
-- Safe to run again later (it only adds what's missing and refreshes functions/policies).

-- =========================================================
-- Profiles: one per account. Friends can see names + mood only.
-- =========================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text unique check (username ~ '^[a-z0-9_]{3,20}$'),
  nickname    text not null default '' check (char_length(nickname) <= 24),
  frog_name   text not null default 'Pip' check (char_length(frog_name) between 1 and 24),
  friend_code text not null unique default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)),
  mood        text not null default 'happy' check (mood in ('happy', 'worried', 'sad', 'sleeping')),
  mood_at     timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username, nickname, frog_name, mood, mood_at) on public.profiles to authenticated;

-- New account → new profile (username / nickname / frog name come from the sign-up form).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  wanted text := lower(nullif(trim(new.raw_user_meta_data ->> 'username'), ''));
begin
  if wanted is not null and (wanted !~ '^[a-z0-9_]{3,20}$' or exists (select 1 from public.profiles where username = wanted)) then
    wanted := null; -- taken or invalid: they can pick one later in Settings
  end if;
  insert into public.profiles (id, username, nickname, frog_name)
  values (
    new.id,
    wanted,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'nickname'), ''), split_part(coalesce(new.raw_user_meta_data ->> 'full_name', ''), ' ', 1), ''), 24),
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'frog_name'), ''), 'Pip'), 24)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.username_available(name text)
returns boolean language sql stable security definer set search_path = public as $$
  select lower(name) ~ '^[a-z0-9_]{3,20}$'
     and not exists (select 1 from public.profiles where username = lower(name) and id is distinct from auth.uid());
$$;
revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- =========================================================
-- Synced app data
-- =========================================================
create table if not exists public.user_state (
  user_id      uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  settings     jsonb,
  settings_at  timestamptz,
  favorites    jsonb,
  favorites_at timestamptz,
  archive      jsonb,
  archive_at   timestamptz,
  prefs        jsonb,
  prefs_at     timestamptz,
  updated_at   timestamptz not null default now()
);

alter table public.user_state enable row level security;
drop policy if exists "own state" on public.user_state;
create policy "own state" on public.user_state for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.user_state to authenticated;

create table if not exists public.entries (
  id         text primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type       text not null check (type in ('swipe', 'exchange', 'points', 'guest', 'adjust-swipes', 'adjust-points', 'fund-swipes', 'fund-points')),
  amount     numeric(10, 2) not null,
  date       date not null,
  time       text,
  note       text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted    boolean not null default false,
  synced_at  timestamptz not null default now()
);
alter table public.entries add column if not exists time text;
create index if not exists entries_user_synced on public.entries (user_id, synced_at);

-- Every write stamps synced_at (so other devices can fetch "what changed since"),
-- and an older edit can never overwrite a newer one.
create or replace function public.entries_touch()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id then raise exception 'not yours'; end if;
    if new.updated_at < old.updated_at then return old; end if;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists entries_touch on public.entries;
create trigger entries_touch before insert or update on public.entries
  for each row execute function public.entries_touch();

alter table public.entries enable row level security;
drop policy if exists "own entries" on public.entries;
create policy "own entries" on public.entries for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.entries to authenticated;

-- =========================================================
-- Friends
-- =========================================================
create table if not exists public.friendships (
  requester  uuid not null references auth.users (id) on delete cascade,
  addressee  uuid not null references auth.users (id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);
create unique index if not exists friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));
alter table public.friendships enable row level security;
revoke all on public.friendships from anon, authenticated; -- only through the functions below

create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships
    where status = 'accepted' and ((requester = a and addressee = b) or (requester = b and addressee = a)));
$$;
revoke all on function public.are_friends(uuid, uuid) from public;

-- Add by username or friend code. Returns: sent | accepted | already | pending | not_found | self
create or replace function public.send_friend_request(target text)
returns text language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  them uuid;
  existing public.friendships;
begin
  if me is null then raise exception 'sign in first'; end if;
  target := trim(coalesce(target, ''));
  select id into them from public.profiles
    where username = lower(ltrim(target, '@')) or friend_code = upper(target)
    limit 1;
  if them is null then return 'not_found'; end if;
  if them = me then return 'self'; end if;

  select * into existing from public.friendships
    where (requester = me and addressee = them) or (requester = them and addressee = me);
  if found then
    if existing.status = 'accepted' then return 'already'; end if;
    if existing.requester = them then -- they already asked you: that's a yes
      update public.friendships set status = 'accepted' where requester = them and addressee = me;
      return 'accepted';
    end if;
    return 'pending';
  end if;

  if (select count(*) from public.friendships where requester = me and status = 'pending') >= 30 then
    raise exception 'Too many pending requests. Wait for some to be accepted.';
  end if;
  insert into public.friendships (requester, addressee) values (me, them);
  return 'sent';
end $$;

create or replace function public.respond_friend_request(other uuid, accept boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if accept then
    update public.friendships set status = 'accepted'
      where requester = other and addressee = auth.uid() and status = 'pending';
  else
    delete from public.friendships where requester = other and addressee = auth.uid() and status = 'pending';
  end if;
end $$;

-- Unfriend, cancel a request you sent, or decline one you got.
create or replace function public.remove_friend(other uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.friendships
    where (requester = auth.uid() and addressee = other) or (requester = other and addressee = auth.uid());
$$;

-- Everyone you're connected to. Friends see names + mood only.
create or replace function public.my_friends()
returns table (id uuid, username text, nickname text, frog_name text, mood text, mood_at timestamptz, status text, since timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.nickname, p.frog_name,
         case when f.status = 'accepted' then p.mood else null end,
         case when f.status = 'accepted' then p.mood_at else null end,
         case when f.status = 'accepted' then 'friend'
              when f.requester = auth.uid() then 'outgoing'
              else 'incoming' end,
         f.created_at
  from public.friendships f
  join public.profiles p on p.id = case when f.requester = auth.uid() then f.addressee else f.requester end
  where auth.uid() in (f.requester, f.addressee)
  order by f.created_at;
$$;

-- Snacks, cheers, visits and dances.
create table if not exists public.pings (
  id         bigint generated always as identity primary key,
  sender     uuid not null references auth.users (id) on delete cascade,
  recipient  uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('snack', 'cheer', 'visit', 'dance')),
  created_at timestamptz not null default now(),
  seen       boolean not null default false
);
create index if not exists pings_recipient on public.pings (recipient, seen, created_at);
alter table public.pings enable row level security;
revoke all on public.pings from anon, authenticated;

create or replace function public.send_ping(friend uuid, what text)
returns bigint language plpgsql security definer set search_path = public as $$
declare new_id bigint;
begin
  if not public.are_friends(auth.uid(), friend) then raise exception 'You can only send these to friends.'; end if;
  if exists (select 1 from public.pings where sender = auth.uid() and recipient = friend and kind = what
             and created_at > now() - interval '10 minutes') then
    raise exception 'slow_down';
  end if;
  insert into public.pings (sender, recipient, kind) values (auth.uid(), friend, what) returning id into new_id;
  return new_id;
end $$;

create or replace function public.my_pings()
returns table (id bigint, kind text, created_at timestamptz, sender uuid, nickname text, username text, frog_name text, mood text)
language sql stable security definer set search_path = public as $$
  select g.id, g.kind, g.created_at, p.id, p.nickname, p.username, p.frog_name, p.mood
  from public.pings g join public.profiles p on p.id = g.sender
  where g.recipient = auth.uid() and not g.seen and g.created_at > now() - interval '3 days'
    and public.are_friends(auth.uid(), g.sender)
  order by g.created_at;
$$;

create or replace function public.mark_pings_seen(ids bigint[])
returns void language sql security definer set search_path = public as $$
  update public.pings set seen = true where recipient = auth.uid() and id = any(ids);
$$;

revoke all on function public.send_friend_request(text), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid), public.my_friends(), public.send_ping(uuid, text), public.my_pings(),
  public.mark_pings_seen(bigint[]) from public, anon;
grant execute on function public.send_friend_request(text), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid), public.my_friends(), public.send_ping(uuid, text), public.my_pings(),
  public.mark_pings_seen(bigint[]) to authenticated;

-- =========================================================
-- Notifications
-- =========================================================
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

create or replace function public.save_push_subscription(endpoint text, p256dh text, auth_key text)
returns void language sql security definer set search_path = public as $$
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (endpoint, auth.uid(), p256dh, auth_key)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
$$;

create or replace function public.delete_push_subscription(endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions s where s.endpoint = delete_push_subscription.endpoint and s.user_id = auth.uid();
$$;

-- What the reminder robot needs to know (the app keeps this up to date).
create table if not exists public.notify_state (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  tz         text not null default 'America/New_York',
  prefs      jsonb not null default '{}'::jsonb,
  semester   jsonb,
  snapshot   jsonb,
  sent       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.notify_state enable row level security;
drop policy if exists "own notify state" on public.notify_state;
create policy "own notify state" on public.notify_state for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.notify_state from anon, authenticated;
grant select, insert (user_id, tz, prefs, semester, snapshot, updated_at),
  update (user_id, tz, prefs, semester, snapshot, updated_at) on public.notify_state to authenticated;

revoke all on function public.save_push_subscription(text, text, text), public.delete_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text), public.delete_push_subscription(text) to authenticated;

-- Study planner. Safe to run again.
alter table public.user_state add column if not exists study jsonb;
alter table public.user_state add column if not exists study_at timestamptz;
alter table public.notify_state add column if not exists study jsonb;
grant insert (study), update (study) on public.notify_state to authenticated;

alter table public.user_state add column if not exists decks jsonb;
alter table public.user_state add column if not exists decks_at timestamptz;
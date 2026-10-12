create table if not exists public.admin_allowlist (
    email text primary key check (email = lower(trim(email))),
    user_id uuid unique references auth.users (id) on delete set null,
    added_at timestamptz not null default now()
);

create table if not exists public.events (
    id uuid primary key default gen_random_uuid(),
    title text not null check (length(trim(title)) between 1 and 120),
    description text not null default '' check (length(description) <= 2000),
    event_date date not null,
    event_time time,
    location text not null default '' check (length(location) <= 160),
    poster_path text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists events_event_date_idx on public.events (event_date);

create table if not exists public.event_notifications (
    id uuid primary key default gen_random_uuid(),
    event_id uuid references public.events (id) on delete set null,
    action text not null check (action in ('created', 'updated', 'deleted')),
    event_title text not null,
    event_description text not null default '',
    event_date date not null,
    poster_path text not null default '',
    created_at timestamptz not null default now(),
    push_sent_at timestamptz
);

create index if not exists event_notifications_created_at_idx
    on public.event_notifications (created_at desc);

create table if not exists public.push_subscriptions (
    endpoint text primary key check (length(endpoint) <= 2048),
    subscription jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.admin_allowlist enable row level security;
alter table public.events enable row level security;
alter table public.event_notifications enable row level security;
alter table public.push_subscriptions enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.admin_allowlist
        where user_id = (select auth.uid())
    );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

create or replace function public.link_invited_admin()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    if new.email_confirmed_at is null then
        return new;
    end if;

    update public.admin_allowlist
    set user_id = new.id
    where email = lower(trim(new.email))
      and (user_id is null or user_id = new.id);
    return new;
end;
$$;

drop trigger if exists link_invited_admin_after_signup on auth.users;
create trigger link_invited_admin_after_signup
after insert or update of email, email_confirmed_at on auth.users
for each row execute function public.link_invited_admin();

create or replace function public.link_existing_invited_admin()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
    update public.admin_allowlist
    set user_id = invited_user.id
    from auth.users as invited_user
    where public.admin_allowlist.email = new.email
      and public.admin_allowlist.user_id is null
      and lower(trim(invited_user.email)) = new.email
      and invited_user.email_confirmed_at is not null;
    return new;
end;
$$;

drop trigger if exists link_existing_invited_admin_after_invite on public.admin_allowlist;
create trigger link_existing_invited_admin_after_invite
after insert on public.admin_allowlist
for each row execute function public.link_existing_invited_admin();

drop policy if exists "Anyone can read event listings" on public.events;
create policy "Anyone can read event listings"
    on public.events for select to anon, authenticated using (true);
drop policy if exists "Admins can insert events" on public.events;
create policy "Admins can insert events"
    on public.events for insert to authenticated with check (public.is_admin());
drop policy if exists "Admins can update events" on public.events;
create policy "Admins can update events"
    on public.events for update to authenticated
    using (public.is_admin()) with check (public.is_admin());
drop policy if exists "Admins can delete events" on public.events;
create policy "Admins can delete events"
    on public.events for delete to authenticated using (public.is_admin());

drop policy if exists "Visitors can read event notifications" on public.event_notifications;
create policy "Visitors can read event notifications"
    on public.event_notifications for select to anon, authenticated using (true);

drop policy if exists "Admins can read signup settings" on public.admin_allowlist;
create policy "Admins can read signup settings"
    on public.admin_allowlist for select to authenticated using (public.is_admin());
drop policy if exists "Admins can invite admins" on public.admin_allowlist;
create policy "Admins can invite admins"
    on public.admin_allowlist for insert to authenticated
    with check (public.is_admin() and user_id is null);
drop policy if exists "Admins can revoke invited admins" on public.admin_allowlist;
create policy "Admins can revoke invited admins"
    on public.admin_allowlist for delete to authenticated
    using (public.is_admin() and (user_id is null or user_id <> (select auth.uid())));

revoke all on public.events, public.event_notifications, public.admin_allowlist,
    public.push_subscriptions from anon, authenticated;
grant select on public.events, public.event_notifications to anon, authenticated;
grant insert, update, delete on public.events to authenticated;
grant select, insert, delete on public.admin_allowlist to authenticated;
revoke all on public.push_subscriptions from anon, authenticated;

create or replace function public.record_event_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    event_row public.events;
    event_action text;
begin
    if tg_op = 'INSERT' then
        event_row := new;
        event_action := 'created';
    elsif tg_op = 'UPDATE' then
        event_row := new;
        event_action := 'updated';
    else
        event_row := old;
        event_action := 'deleted';
    end if;

    insert into public.event_notifications (
        event_id, action, event_title, event_description, event_date, poster_path
    ) values (
        case when event_action = 'deleted' then null else event_row.id end,
        event_action,
        event_row.title,
        event_row.description,
        event_row.event_date,
        event_row.poster_path
    );

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

drop trigger if exists record_event_notification_after_change on public.events;
create trigger record_event_notification_after_change
after insert or update or delete on public.events
for each row execute function public.record_event_notification();

insert into storage.buckets (
    id, name, public, file_size_limit, allowed_mime_types
)
values (
    'event-posters',
    'event-posters',
    true,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can view event posters" on storage.objects;
create policy "Anyone can view event posters"
    on storage.objects for select to anon, authenticated
    using (bucket_id = 'event-posters');
drop policy if exists "Admins can upload event posters" on storage.objects;
create policy "Admins can upload event posters"
    on storage.objects for insert to authenticated
    with check (bucket_id = 'event-posters' and public.is_admin());
drop policy if exists "Admins can update event posters" on storage.objects;
create policy "Admins can update event posters"
    on storage.objects for update to authenticated
    using (bucket_id = 'event-posters' and public.is_admin())
    with check (bucket_id = 'event-posters' and public.is_admin());
drop policy if exists "Admins can delete event posters" on storage.objects;
create policy "Admins can delete event posters"
    on storage.objects for delete to authenticated
    using (bucket_id = 'event-posters' and public.is_admin());

do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'events'
    ) then
        alter publication supabase_realtime add table public.events;
    end if;
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'event_notifications'
    ) then
        alter publication supabase_realtime add table public.event_notifications;
    end if;
end;
$$;

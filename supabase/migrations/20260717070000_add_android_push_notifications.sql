create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  app_user_id text not null references public.app_users(id) on delete cascade,
  token text not null unique,
  platform text not null default 'android' check (platform in ('android')),
  device_label text not null default '',
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists device_push_tokens_app_user_idx
  on public.device_push_tokens (app_user_id)
  where enabled;

alter table public.device_push_tokens enable row level security;

drop policy if exists "Users can read their push tokens" on public.device_push_tokens;
create policy "Users can read their push tokens" on public.device_push_tokens
  for select to authenticated
  using (auth_user_id = auth.uid() and app_user_id = public.current_app_user_id());

drop policy if exists "Users can register their push tokens" on public.device_push_tokens;
create policy "Users can register their push tokens" on public.device_push_tokens
  for insert to authenticated
  with check (auth_user_id = auth.uid() and app_user_id = public.current_app_user_id());

drop policy if exists "Users can refresh their push tokens" on public.device_push_tokens;
create policy "Users can refresh their push tokens" on public.device_push_tokens
  for update to authenticated
  using (auth_user_id = auth.uid() and app_user_id = public.current_app_user_id())
  with check (auth_user_id = auth.uid() and app_user_id = public.current_app_user_id());

drop policy if exists "Users can delete their push tokens" on public.device_push_tokens;
create policy "Users can delete their push tokens" on public.device_push_tokens
  for delete to authenticated
  using (auth_user_id = auth.uid() and app_user_id = public.current_app_user_id());

grant select, insert, update, delete on public.device_push_tokens to authenticated;

create or replace function public.register_device_push_token(p_token text, p_device_label text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id text := public.current_app_user_id();
begin
  if auth.uid() is null or current_user_id is null then
    raise exception 'A recognized signed-in app user is required.';
  end if;
  if coalesce(trim(p_token), '') = '' then
    raise exception 'A push token is required.';
  end if;
  delete from public.device_push_tokens where token = trim(p_token);
  insert into public.device_push_tokens (
    auth_user_id, app_user_id, token, platform, device_label, enabled, last_seen_at, updated_at
  ) values (
    auth.uid(), current_user_id, trim(p_token), 'android', left(coalesce(p_device_label, ''), 240), true, now(), now()
  );
end;
$$;

create or replace function public.unregister_device_push_token(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.device_push_tokens
  where token = trim(p_token)
    and auth_user_id = auth.uid()
    and app_user_id = public.current_app_user_id()
$$;

revoke all on function public.register_device_push_token(text, text) from public, anon;
revoke all on function public.unregister_device_push_token(text) from public, anon;
grant execute on function public.register_device_push_token(text, text) to authenticated;
grant execute on function public.unregister_device_push_token(text) to authenticated;

create table if not exists public.push_notification_events (
  id text primary key,
  actor_auth_user_id uuid references auth.users(id) on delete set null,
  actor_app_user_id text references public.app_users(id) on delete set null,
  project_id text not null references public.projects(id) on delete cascade,
  kind text not null,
  entity_id text not null default '',
  recipient_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.push_notification_events enable row level security;
revoke all on public.push_notification_events from anon, authenticated;

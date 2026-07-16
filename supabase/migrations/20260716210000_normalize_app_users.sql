create table if not exists public.app_users (
  id text primary key,
  position integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_users_email_idx
  on public.app_users (lower(data->>'email'))
  where coalesce(data->>'email', '') <> '';

alter table public.app_users enable row level security;
drop policy if exists "Authenticated users can read app users" on public.app_users;
create policy "Authenticated users can read app users" on public.app_users
  for select to authenticated using (auth.uid() is not null);

revoke insert, update, delete on public.app_users from anon, authenticated;
grant select on public.app_users to authenticated;

create or replace function public.sync_normalized_app_users(p_settings_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  users_json jsonb := case
    when jsonb_typeof(p_settings_data->'users') = 'array' then p_settings_data->'users'
    else '[]'::jsonb
  end;
begin
  delete from public.app_users existing
  where not exists (
    select 1 from jsonb_array_elements(users_json) source(item)
    where coalesce(source.item->>'id', '') = existing.id
  );

  insert into public.app_users (id, position, data)
  select source.item->>'id', source.position::integer - 1, source.item - 'id'
  from jsonb_array_elements(users_json) with ordinality source(item, position)
  where coalesce(source.item->>'id', '') <> ''
  on conflict (id) do update set
    position = excluded.position,
    data = excluded.data,
    version = case when public.app_users.position is distinct from excluded.position
      or public.app_users.data is distinct from excluded.data
      then public.app_users.version + 1 else public.app_users.version end,
    updated_at = case when public.app_users.position is distinct from excluded.position
      or public.app_users.data is distinct from excluded.data
      then now() else public.app_users.updated_at end;
end;
$$;

revoke all on function public.sync_normalized_app_users(jsonb) from public, anon, authenticated;

create or replace function public.sync_normalized_app_users_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.id = 'app_settings' then perform public.sync_normalized_app_users(new.data); end if;
  return new;
end;
$$;

drop trigger if exists settings_normalized_app_users_trigger on public.settings;
create trigger settings_normalized_app_users_trigger
after insert or update of data on public.settings
for each row execute function public.sync_normalized_app_users_trigger();

do $$
declare settings_data jsonb;
begin
  select data into settings_data from public.settings where id = 'app_settings';
  if settings_data is not null then perform public.sync_normalized_app_users(settings_data); end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_user_access_app_user_fk') then
    alter table public.project_user_access
      add constraint project_user_access_app_user_fk
      foreign key (user_id) references public.app_users(id) on delete cascade not valid;
  end if;
end;
$$;

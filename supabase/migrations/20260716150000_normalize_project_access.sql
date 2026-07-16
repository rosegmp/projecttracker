create table if not exists public.project_user_access (
  project_id text not null references public.projects(id) on delete cascade,
  user_id text not null,
  position integer not null default 0,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_user_access_user_idx on public.project_user_access (user_id, project_id);

alter table public.project_user_access enable row level security;
drop policy if exists "App users can read project access" on public.project_user_access;
create policy "App users can read project access" on public.project_user_access
  for select to authenticated using (auth.uid() is not null);

revoke insert, update, delete on public.project_user_access from anon, authenticated;
grant select on public.project_user_access to authenticated;

create or replace function public.sync_normalized_project_access(p_project_id text, p_project_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  access_ids jsonb := case
    when jsonb_typeof(p_project_data->'accessUserIds') = 'array' then p_project_data->'accessUserIds'
    else '[]'::jsonb
  end;
begin
  delete from public.project_user_access existing
  where existing.project_id = p_project_id
    and not exists (
      select 1 from jsonb_array_elements_text(access_ids) value where trim(value) = existing.user_id
    );

  insert into public.project_user_access (project_id, user_id, position)
  select p_project_id, trim(value), min(position)::integer - 1
  from jsonb_array_elements_text(access_ids) with ordinality source(value, position)
  where trim(value) <> ''
  group by trim(value)
  on conflict (project_id, user_id) do update set
    position = excluded.position,
    version = case when public.project_user_access.position is distinct from excluded.position
      then public.project_user_access.version + 1 else public.project_user_access.version end,
    updated_at = case when public.project_user_access.position is distinct from excluded.position
      then now() else public.project_user_access.updated_at end;
end;
$$;

revoke all on function public.sync_normalized_project_access(text, jsonb) from public, anon, authenticated;

create or replace function public.sync_normalized_project_access_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.sync_normalized_project_access(new.id, new.data); return new; end;
$$;

drop trigger if exists projects_normalized_access_trigger on public.projects;
create trigger projects_normalized_access_trigger
after insert or update of data on public.projects
for each row execute function public.sync_normalized_project_access_trigger();

do $$
declare project_row record;
begin
  for project_row in select id, data from public.projects loop
    perform public.sync_normalized_project_access(project_row.id, project_row.data);
  end loop;
end;
$$;

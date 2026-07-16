create table if not exists public.project_inspections (
  project_id text not null references public.projects(id) on delete cascade,
  id text not null,
  position integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

create table if not exists public.project_inspection_files (
  project_id text not null,
  inspection_id text not null,
  kind text not null check (kind in ('sticker', 'report')),
  id text not null,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, inspection_id, kind),
  foreign key (project_id, inspection_id)
    references public.project_inspections(project_id, id)
    on delete cascade
);

create index if not exists project_inspections_project_position_idx
  on public.project_inspections (project_id, position, id);
create index if not exists project_inspection_files_inspection_idx
  on public.project_inspection_files (project_id, inspection_id, kind);

alter table public.project_inspections enable row level security;
alter table public.project_inspection_files enable row level security;

drop policy if exists "App users can read project inspections" on public.project_inspections;
create policy "App users can read project inspections"
  on public.project_inspections for select to authenticated
  using (
    exists (
      select 1
      from public.settings app_settings,
        jsonb_array_elements(coalesce(app_settings.data->'users', '[]'::jsonb)) app_user
      where app_settings.id = 'app_settings'
        and lower(coalesce(app_user->>'email', '')) = lower(coalesce(auth.jwt()->>'email', ''))
    )
  );

drop policy if exists "App users can read inspection files" on public.project_inspection_files;
create policy "App users can read inspection files"
  on public.project_inspection_files for select to authenticated
  using (
    exists (
      select 1
      from public.settings app_settings,
        jsonb_array_elements(coalesce(app_settings.data->'users', '[]'::jsonb)) app_user
      where app_settings.id = 'app_settings'
        and lower(coalesce(app_user->>'email', '')) = lower(coalesce(auth.jwt()->>'email', ''))
    )
  );

revoke insert, update, delete on public.project_inspections from anon, authenticated;
revoke insert, update, delete on public.project_inspection_files from anon, authenticated;
grant select on public.project_inspections to authenticated;
grant select on public.project_inspection_files to authenticated;

create or replace function public.sync_normalized_project_inspections(
  p_project_id text,
  p_project_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inspections jsonb := case
    when jsonb_typeof(coalesce(p_project_data->'inspections', '[]'::jsonb)) = 'array'
      then coalesce(p_project_data->'inspections', '[]'::jsonb)
    else '[]'::jsonb
  end;
begin
  delete from public.project_inspection_files inspection_file
  where inspection_file.project_id = p_project_id
    and not exists (
      select 1
      from jsonb_array_elements(inspections) inspection
      cross join lateral (
        values
          ('sticker'::text, inspection->'stickerFile'),
          ('report'::text, inspection->'reportFile')
      ) attachment(kind, file_data)
      where nullif(inspection->>'id', '') = inspection_file.inspection_id
        and attachment.kind = inspection_file.kind
        and jsonb_typeof(attachment.file_data) = 'object'
        and nullif(attachment.file_data->>'id', '') = inspection_file.id
    );

  delete from public.project_inspections project_inspection
  where project_inspection.project_id = p_project_id
    and not exists (
      select 1
      from jsonb_array_elements(inspections) inspection
      where nullif(inspection->>'id', '') = project_inspection.id
    );

  insert into public.project_inspections (project_id, id, position, data)
  select
    p_project_id,
    inspection->>'id',
    inspection_ordinality::integer - 1,
    inspection - 'stickerFile' - 'reportFile'
  from jsonb_array_elements(inspections) with ordinality inspection_row(inspection, inspection_ordinality)
  where nullif(inspection->>'id', '') is not null
  on conflict (project_id, id) do update set
    position = excluded.position,
    data = excluded.data,
    version = case
      when project_inspections.position is distinct from excluded.position
        or project_inspections.data is distinct from excluded.data
      then project_inspections.version + 1
      else project_inspections.version
    end,
    updated_at = case
      when project_inspections.position is distinct from excluded.position
        or project_inspections.data is distinct from excluded.data
      then now()
      else project_inspections.updated_at
    end;

  insert into public.project_inspection_files (project_id, inspection_id, kind, id, data)
  select
    p_project_id,
    inspection->>'id',
    attachment.kind,
    attachment.file_data->>'id',
    attachment.file_data
  from jsonb_array_elements(inspections) inspection
  cross join lateral (
    values
      ('sticker'::text, inspection->'stickerFile'),
      ('report'::text, inspection->'reportFile')
  ) attachment(kind, file_data)
  where nullif(inspection->>'id', '') is not null
    and jsonb_typeof(attachment.file_data) = 'object'
    and nullif(attachment.file_data->>'id', '') is not null
  on conflict (project_id, inspection_id, kind) do update set
    id = excluded.id,
    data = excluded.data,
    version = case
      when project_inspection_files.id is distinct from excluded.id
        or project_inspection_files.data is distinct from excluded.data
      then project_inspection_files.version + 1
      else project_inspection_files.version
    end,
    updated_at = case
      when project_inspection_files.id is distinct from excluded.id
        or project_inspection_files.data is distinct from excluded.data
      then now()
      else project_inspection_files.updated_at
    end;
end;
$$;

revoke all on function public.sync_normalized_project_inspections(text, jsonb) from public, anon, authenticated;

create or replace function public.sync_normalized_project_inspections_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_normalized_project_inspections(new.id, new.data);
  return new;
end;
$$;

drop trigger if exists projects_normalized_inspections_insert_trigger on public.projects;
create trigger projects_normalized_inspections_insert_trigger
after insert on public.projects
for each row execute function public.sync_normalized_project_inspections_trigger();

drop trigger if exists projects_normalized_inspections_update_trigger on public.projects;
create trigger projects_normalized_inspections_update_trigger
after update of data on public.projects
for each row
when (old.data->'inspections' is distinct from new.data->'inspections')
execute function public.sync_normalized_project_inspections_trigger();

create or replace function public.save_normalized_project_inspections(
  p_project_id text,
  p_inspections jsonb,
  p_expected_versions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  actor_app_user_id text;
  project_data jsonb;
  next_data jsonb;
  next_version bigint;
  version_row record;
  expected_map jsonb;
  expected_count integer;
  actual_count integer;
  inspection_versions jsonb;
  inspection_file_versions jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_inspections, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_expected_versions, '{}'::jsonb)) <> 'object' then
    raise exception 'Inspections and versions have invalid shapes.' using errcode = '22023';
  end if;

  select app_user->>'id', app_user->>'role'
    into actor_app_user_id, actor_role
    from public.settings app_settings,
      jsonb_array_elements(coalesce(app_settings.data->'users', '[]'::jsonb)) app_user
    where app_settings.id = 'app_settings'
      and lower(coalesce(app_user->>'email', '')) = lower(coalesce(auth.jwt()->>'email', ''))
    limit 1;
  if coalesce(actor_role, '') not in ('Admin', 'Edit') then
    raise exception 'You do not have permission to edit tracker records.' using errcode = '42501';
  end if;

  select data into project_data
  from public.projects
  where id = p_project_id
  for update;
  if project_data is null then
    raise exception 'Project was not found.' using errcode = 'P0002';
  end if;
  if actor_role = 'Edit'
    and jsonb_array_length(coalesce(project_data->'accessUserIds', '[]'::jsonb)) > 0
    and not exists (
      select 1
      from jsonb_array_elements_text(coalesce(project_data->'accessUserIds', '[]'::jsonb)) access_id
      where access_id = actor_app_user_id
    ) then
    raise exception 'You do not have access to this project.' using errcode = '42501';
  end if;

  expected_map := coalesce(p_expected_versions->'inspections', '{}'::jsonb);
  expected_count := (select count(*) from jsonb_object_keys(expected_map));
  actual_count := (select count(*) from public.project_inspections where project_id = p_project_id);
  if expected_count <> actual_count then
    raise exception 'NORMALIZED_VERSION_CONFLICT:inspections:%', p_project_id using errcode = '40001';
  end if;
  for version_row in select id as key, version from public.project_inspections where project_id = p_project_id loop
    if coalesce((expected_map->>version_row.key)::bigint, -1) <> version_row.version then
      raise exception 'NORMALIZED_VERSION_CONFLICT:inspections:%', version_row.key using errcode = '40001';
    end if;
  end loop;

  expected_map := coalesce(p_expected_versions->'inspectionFiles', '{}'::jsonb);
  expected_count := (select count(*) from jsonb_object_keys(expected_map));
  actual_count := (select count(*) from public.project_inspection_files where project_id = p_project_id);
  if expected_count <> actual_count then
    raise exception 'NORMALIZED_VERSION_CONFLICT:inspectionFiles:%', p_project_id using errcode = '40001';
  end if;
  for version_row in
    select inspection_id || ':' || kind as key, version
    from public.project_inspection_files where project_id = p_project_id
  loop
    if coalesce((expected_map->>version_row.key)::bigint, -1) <> version_row.version then
      raise exception 'NORMALIZED_VERSION_CONFLICT:inspectionFiles:%', version_row.key using errcode = '40001';
    end if;
  end loop;

  next_data := jsonb_set(project_data, '{inspections}', p_inspections, true);
  perform public.sync_normalized_project_inspections(p_project_id, next_data);
  update public.projects set data = next_data where id = p_project_id returning version into next_version;

  select coalesce(jsonb_object_agg(id, version), '{}'::jsonb)
    into inspection_versions
    from public.project_inspections where project_id = p_project_id;
  select coalesce(jsonb_object_agg(inspection_id || ':' || kind, version), '{}'::jsonb)
    into inspection_file_versions
    from public.project_inspection_files where project_id = p_project_id;

  return jsonb_build_object(
    'version', next_version,
    'normalizedVersions', jsonb_build_object(
      'inspections', inspection_versions,
      'inspectionFiles', inspection_file_versions
    )
  );
end;
$$;

revoke all on function public.save_normalized_project_inspections(text, jsonb, jsonb) from public, anon;
grant execute on function public.save_normalized_project_inspections(text, jsonb, jsonb) to authenticated;

do $$
declare
  project_row record;
begin
  for project_row in select id, data from public.projects loop
    perform public.sync_normalized_project_inspections(project_row.id, project_row.data);
  end loop;
end;
$$;

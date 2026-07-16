create table if not exists public.project_file_folders (
  project_id text not null references public.projects(id) on delete cascade,
  id text not null,
  position integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

create table if not exists public.project_files (
  project_id text not null,
  folder_id text not null,
  id text not null,
  position integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, folder_id, id),
  foreign key (project_id, folder_id)
    references public.project_file_folders(project_id, id)
    on delete cascade
);

create table if not exists public.project_photos (
  project_id text not null references public.projects(id) on delete cascade,
  id text not null,
  position integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

create index if not exists project_file_folders_project_position_idx
  on public.project_file_folders (project_id, position, id);
create index if not exists project_files_folder_position_idx
  on public.project_files (project_id, folder_id, position, id);
create index if not exists project_photos_project_position_idx
  on public.project_photos (project_id, position, id);

alter table public.project_file_folders enable row level security;
alter table public.project_files enable row level security;
alter table public.project_photos enable row level security;

drop policy if exists "App users can read project file folders" on public.project_file_folders;
create policy "App users can read project file folders"
  on public.project_file_folders for select to authenticated
  using (
    exists (
      select 1
      from public.settings app_settings,
        jsonb_array_elements(coalesce(app_settings.data->'users', '[]'::jsonb)) app_user
      where app_settings.id = 'app_settings'
        and lower(coalesce(app_user->>'email', '')) = lower(coalesce(auth.jwt()->>'email', ''))
    )
  );

drop policy if exists "App users can read project files" on public.project_files;
create policy "App users can read project files"
  on public.project_files for select to authenticated
  using (
    exists (
      select 1
      from public.settings app_settings,
        jsonb_array_elements(coalesce(app_settings.data->'users', '[]'::jsonb)) app_user
      where app_settings.id = 'app_settings'
        and lower(coalesce(app_user->>'email', '')) = lower(coalesce(auth.jwt()->>'email', ''))
    )
  );

drop policy if exists "App users can read project photos" on public.project_photos;
create policy "App users can read project photos"
  on public.project_photos for select to authenticated
  using (
    exists (
      select 1
      from public.settings app_settings,
        jsonb_array_elements(coalesce(app_settings.data->'users', '[]'::jsonb)) app_user
      where app_settings.id = 'app_settings'
        and lower(coalesce(app_user->>'email', '')) = lower(coalesce(auth.jwt()->>'email', ''))
    )
  );

revoke insert, update, delete on public.project_file_folders from anon, authenticated;
revoke insert, update, delete on public.project_files from anon, authenticated;
revoke insert, update, delete on public.project_photos from anon, authenticated;
grant select on public.project_file_folders to authenticated;
grant select on public.project_files to authenticated;
grant select on public.project_photos to authenticated;

create or replace function public.sync_normalized_project_assets(
  p_project_id text,
  p_project_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  folders jsonb := case
    when jsonb_typeof(coalesce(p_project_data->'files'->'folders', '[]'::jsonb)) = 'array'
      then coalesce(p_project_data->'files'->'folders', '[]'::jsonb)
    else '[]'::jsonb
  end;
  photos jsonb := case
    when jsonb_typeof(coalesce(p_project_data->'photos', '[]'::jsonb)) = 'array'
      then coalesce(p_project_data->'photos', '[]'::jsonb)
    else '[]'::jsonb
  end;
begin
  delete from public.project_files project_file
  where project_file.project_id = p_project_id
    and not exists (
      select 1
      from jsonb_array_elements(folders) folder,
        jsonb_array_elements(
          case when jsonb_typeof(coalesce(folder->'files', '[]'::jsonb)) = 'array'
            then coalesce(folder->'files', '[]'::jsonb)
            else '[]'::jsonb
          end
        ) file
      where nullif(folder->>'id', '') = project_file.folder_id
        and nullif(file->>'id', '') = project_file.id
    );

  delete from public.project_file_folders project_folder
  where project_folder.project_id = p_project_id
    and not exists (
      select 1
      from jsonb_array_elements(folders) folder
      where nullif(folder->>'id', '') = project_folder.id
    );

  delete from public.project_photos project_photo
  where project_photo.project_id = p_project_id
    and not exists (
      select 1
      from jsonb_array_elements(photos) photo
      where nullif(photo->>'id', '') = project_photo.id
    );

  insert into public.project_file_folders (project_id, id, position, data)
  select
    p_project_id,
    folder->>'id',
    folder_ordinality::integer - 1,
    folder - 'files'
  from jsonb_array_elements(folders) with ordinality folder_row(folder, folder_ordinality)
  where nullif(folder->>'id', '') is not null
  on conflict (project_id, id) do update set
    position = excluded.position,
    data = excluded.data,
    version = case
      when project_file_folders.position is distinct from excluded.position
        or project_file_folders.data is distinct from excluded.data
      then project_file_folders.version + 1
      else project_file_folders.version
    end,
    updated_at = case
      when project_file_folders.position is distinct from excluded.position
        or project_file_folders.data is distinct from excluded.data
      then now()
      else project_file_folders.updated_at
    end;

  insert into public.project_files (project_id, folder_id, id, position, data)
  select
    p_project_id,
    folder->>'id',
    file->>'id',
    file_ordinality::integer - 1,
    file
  from jsonb_array_elements(folders) folder,
    jsonb_array_elements(
      case when jsonb_typeof(coalesce(folder->'files', '[]'::jsonb)) = 'array'
        then coalesce(folder->'files', '[]'::jsonb)
        else '[]'::jsonb
      end
    ) with ordinality file_row(file, file_ordinality)
  where nullif(folder->>'id', '') is not null
    and nullif(file->>'id', '') is not null
  on conflict (project_id, folder_id, id) do update set
    position = excluded.position,
    data = excluded.data,
    version = case
      when project_files.position is distinct from excluded.position
        or project_files.data is distinct from excluded.data
      then project_files.version + 1
      else project_files.version
    end,
    updated_at = case
      when project_files.position is distinct from excluded.position
        or project_files.data is distinct from excluded.data
      then now()
      else project_files.updated_at
    end;

  insert into public.project_photos (project_id, id, position, data)
  select
    p_project_id,
    photo->>'id',
    photo_ordinality::integer - 1,
    photo
  from jsonb_array_elements(photos) with ordinality photo_row(photo, photo_ordinality)
  where nullif(photo->>'id', '') is not null
  on conflict (project_id, id) do update set
    position = excluded.position,
    data = excluded.data,
    version = case
      when project_photos.position is distinct from excluded.position
        or project_photos.data is distinct from excluded.data
      then project_photos.version + 1
      else project_photos.version
    end,
    updated_at = case
      when project_photos.position is distinct from excluded.position
        or project_photos.data is distinct from excluded.data
      then now()
      else project_photos.updated_at
    end;
end;
$$;

revoke all on function public.sync_normalized_project_assets(text, jsonb) from public, anon, authenticated;

create or replace function public.sync_normalized_project_assets_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_normalized_project_assets(new.id, new.data);
  return new;
end;
$$;

drop trigger if exists projects_normalized_assets_insert_trigger on public.projects;
create trigger projects_normalized_assets_insert_trigger
after insert on public.projects
for each row execute function public.sync_normalized_project_assets_trigger();

drop trigger if exists projects_normalized_assets_update_trigger on public.projects;
create trigger projects_normalized_assets_update_trigger
after update of data on public.projects
for each row
when (
  old.data->'files' is distinct from new.data->'files'
  or old.data->'photos' is distinct from new.data->'photos'
)
execute function public.sync_normalized_project_assets_trigger();

do $$
declare
  project_row record;
begin
  for project_row in select id, data from public.projects loop
    perform public.sync_normalized_project_assets(project_row.id, project_row.data);
  end loop;
end;
$$;

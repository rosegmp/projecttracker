create table if not exists public.project_selections (
  project_id text not null references public.projects(id) on delete cascade,
  id text not null,
  position integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, id)
);

create table if not exists public.project_selection_attachments (
  project_id text not null,
  selection_id text not null,
  id text not null,
  position integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, selection_id, id),
  foreign key (project_id, selection_id)
    references public.project_selections(project_id, id)
    on delete cascade
);

create table if not exists public.project_selection_photos (
  project_id text not null,
  selection_id text not null,
  id text not null,
  position integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, selection_id, id),
  foreign key (project_id, selection_id)
    references public.project_selections(project_id, id)
    on delete cascade
);

create index if not exists project_selections_project_position_idx
  on public.project_selections (project_id, position, id);
create index if not exists project_selection_attachments_position_idx
  on public.project_selection_attachments (project_id, selection_id, position, id);
create index if not exists project_selection_photos_position_idx
  on public.project_selection_photos (project_id, selection_id, position, id);

alter table public.project_selections enable row level security;
alter table public.project_selection_attachments enable row level security;
alter table public.project_selection_photos enable row level security;

drop policy if exists "App users can read project selections" on public.project_selections;
create policy "App users can read project selections"
  on public.project_selections for select to authenticated
  using (
    exists (
      select 1
      from public.settings app_settings,
        jsonb_array_elements(coalesce(app_settings.data->'users', '[]'::jsonb)) app_user
      where app_settings.id = 'app_settings'
        and lower(coalesce(app_user->>'email', '')) = lower(coalesce(auth.jwt()->>'email', ''))
    )
  );

drop policy if exists "App users can read selection attachments" on public.project_selection_attachments;
create policy "App users can read selection attachments"
  on public.project_selection_attachments for select to authenticated
  using (
    exists (
      select 1
      from public.settings app_settings,
        jsonb_array_elements(coalesce(app_settings.data->'users', '[]'::jsonb)) app_user
      where app_settings.id = 'app_settings'
        and lower(coalesce(app_user->>'email', '')) = lower(coalesce(auth.jwt()->>'email', ''))
    )
  );

drop policy if exists "App users can read selection photos" on public.project_selection_photos;
create policy "App users can read selection photos"
  on public.project_selection_photos for select to authenticated
  using (
    exists (
      select 1
      from public.settings app_settings,
        jsonb_array_elements(coalesce(app_settings.data->'users', '[]'::jsonb)) app_user
      where app_settings.id = 'app_settings'
        and lower(coalesce(app_user->>'email', '')) = lower(coalesce(auth.jwt()->>'email', ''))
    )
  );

revoke insert, update, delete on public.project_selections from anon, authenticated;
revoke insert, update, delete on public.project_selection_attachments from anon, authenticated;
revoke insert, update, delete on public.project_selection_photos from anon, authenticated;
grant select on public.project_selections to authenticated;
grant select on public.project_selection_attachments to authenticated;
grant select on public.project_selection_photos to authenticated;

create or replace function public.sync_normalized_project_selections(
  p_project_id text,
  p_project_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selections jsonb := case
    when jsonb_typeof(coalesce(p_project_data->'selections', '[]'::jsonb)) = 'array'
      then coalesce(p_project_data->'selections', '[]'::jsonb)
    else '[]'::jsonb
  end;
begin
  delete from public.project_selection_attachments selection_attachment
  where selection_attachment.project_id = p_project_id
    and not exists (
      select 1
      from jsonb_array_elements(selections) selection,
        jsonb_array_elements(
          case when jsonb_typeof(coalesce(selection->'attachments', '[]'::jsonb)) = 'array'
            then coalesce(selection->'attachments', '[]'::jsonb)
            else '[]'::jsonb
          end
        ) attachment
      where nullif(selection->>'id', '') = selection_attachment.selection_id
        and nullif(attachment->>'id', '') = selection_attachment.id
    );

  delete from public.project_selection_photos selection_photo
  where selection_photo.project_id = p_project_id
    and not exists (
      select 1
      from jsonb_array_elements(selections) selection,
        jsonb_array_elements(
          case when jsonb_typeof(coalesce(selection->'photos', '[]'::jsonb)) = 'array'
            then coalesce(selection->'photos', '[]'::jsonb)
            else '[]'::jsonb
          end
        ) photo
      where nullif(selection->>'id', '') = selection_photo.selection_id
        and nullif(photo->>'id', '') = selection_photo.id
    );

  delete from public.project_selections project_selection
  where project_selection.project_id = p_project_id
    and not exists (
      select 1
      from jsonb_array_elements(selections) selection
      where nullif(selection->>'id', '') = project_selection.id
    );

  insert into public.project_selections (project_id, id, position, data)
  select
    p_project_id,
    selection->>'id',
    selection_ordinality::integer - 1,
    selection - 'attachments' - 'photos'
  from jsonb_array_elements(selections) with ordinality selection_row(selection, selection_ordinality)
  where nullif(selection->>'id', '') is not null
  on conflict (project_id, id) do update set
    position = excluded.position,
    data = excluded.data,
    version = case
      when project_selections.position is distinct from excluded.position
        or project_selections.data is distinct from excluded.data
      then project_selections.version + 1
      else project_selections.version
    end,
    updated_at = case
      when project_selections.position is distinct from excluded.position
        or project_selections.data is distinct from excluded.data
      then now()
      else project_selections.updated_at
    end;

  insert into public.project_selection_attachments (project_id, selection_id, id, position, data)
  select
    p_project_id,
    selection->>'id',
    attachment->>'id',
    attachment_ordinality::integer - 1,
    attachment
  from jsonb_array_elements(selections) selection,
    jsonb_array_elements(
      case when jsonb_typeof(coalesce(selection->'attachments', '[]'::jsonb)) = 'array'
        then coalesce(selection->'attachments', '[]'::jsonb)
        else '[]'::jsonb
      end
    ) with ordinality attachment_row(attachment, attachment_ordinality)
  where nullif(selection->>'id', '') is not null
    and nullif(attachment->>'id', '') is not null
  on conflict (project_id, selection_id, id) do update set
    position = excluded.position,
    data = excluded.data,
    version = case
      when project_selection_attachments.position is distinct from excluded.position
        or project_selection_attachments.data is distinct from excluded.data
      then project_selection_attachments.version + 1
      else project_selection_attachments.version
    end,
    updated_at = case
      when project_selection_attachments.position is distinct from excluded.position
        or project_selection_attachments.data is distinct from excluded.data
      then now()
      else project_selection_attachments.updated_at
    end;

  insert into public.project_selection_photos (project_id, selection_id, id, position, data)
  select
    p_project_id,
    selection->>'id',
    photo->>'id',
    photo_ordinality::integer - 1,
    photo
  from jsonb_array_elements(selections) selection,
    jsonb_array_elements(
      case when jsonb_typeof(coalesce(selection->'photos', '[]'::jsonb)) = 'array'
        then coalesce(selection->'photos', '[]'::jsonb)
        else '[]'::jsonb
      end
    ) with ordinality photo_row(photo, photo_ordinality)
  where nullif(selection->>'id', '') is not null
    and nullif(photo->>'id', '') is not null
  on conflict (project_id, selection_id, id) do update set
    position = excluded.position,
    data = excluded.data,
    version = case
      when project_selection_photos.position is distinct from excluded.position
        or project_selection_photos.data is distinct from excluded.data
      then project_selection_photos.version + 1
      else project_selection_photos.version
    end,
    updated_at = case
      when project_selection_photos.position is distinct from excluded.position
        or project_selection_photos.data is distinct from excluded.data
      then now()
      else project_selection_photos.updated_at
    end;
end;
$$;

revoke all on function public.sync_normalized_project_selections(text, jsonb) from public, anon, authenticated;

create or replace function public.sync_normalized_project_selections_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_normalized_project_selections(new.id, new.data);
  return new;
end;
$$;

drop trigger if exists projects_normalized_selections_insert_trigger on public.projects;
create trigger projects_normalized_selections_insert_trigger
after insert on public.projects
for each row execute function public.sync_normalized_project_selections_trigger();

drop trigger if exists projects_normalized_selections_update_trigger on public.projects;
create trigger projects_normalized_selections_update_trigger
after update of data on public.projects
for each row
when (old.data->'selections' is distinct from new.data->'selections')
execute function public.sync_normalized_project_selections_trigger();

do $$
declare
  project_row record;
begin
  for project_row in select id, data from public.projects loop
    perform public.sync_normalized_project_selections(project_row.id, project_row.data);
  end loop;
end;
$$;

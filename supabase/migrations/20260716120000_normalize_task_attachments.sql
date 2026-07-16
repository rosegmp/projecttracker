create table if not exists public.task_attachments (
  task_id text not null references public.tasks(id) on delete cascade,
  id text not null,
  position integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (task_id, id)
);

create index if not exists task_attachments_task_position_idx
  on public.task_attachments (task_id, position, id);

alter table public.task_attachments enable row level security;

drop policy if exists "App users can read task attachments" on public.task_attachments;
create policy "App users can read task attachments"
  on public.task_attachments for select to authenticated
  using (
    exists (
      select 1
      from public.settings app_settings,
        jsonb_array_elements(coalesce(app_settings.data->'users', '[]'::jsonb)) app_user
      where app_settings.id = 'app_settings'
        and lower(coalesce(app_user->>'email', '')) = lower(coalesce(auth.jwt()->>'email', ''))
    )
  );

revoke insert, update, delete on public.task_attachments from anon, authenticated;
grant select on public.task_attachments to authenticated;

create or replace function public.sync_normalized_task_attachments(
  p_task_id text,
  p_task_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  attachments jsonb := case
    when jsonb_typeof(coalesce(p_task_data->'attachments', '[]'::jsonb)) = 'array'
      then coalesce(p_task_data->'attachments', '[]'::jsonb)
    else '[]'::jsonb
  end;
begin
  delete from public.task_attachments attachment
  where attachment.task_id = p_task_id
    and not exists (
      select 1
      from jsonb_array_elements(attachments) with ordinality source(item, position)
      where coalesce(source.item->>'id', '') = attachment.id
    );

  insert into public.task_attachments (task_id, id, position, data)
  select
    p_task_id,
    source.item->>'id',
    source.position::integer - 1,
    source.item - 'id'
  from jsonb_array_elements(attachments) with ordinality source(item, position)
  where coalesce(source.item->>'id', '') <> ''
  on conflict (task_id, id) do update
  set
    position = excluded.position,
    data = excluded.data,
    version = case
      when public.task_attachments.position is distinct from excluded.position
        or public.task_attachments.data is distinct from excluded.data
      then public.task_attachments.version + 1
      else public.task_attachments.version
    end,
    updated_at = case
      when public.task_attachments.position is distinct from excluded.position
        or public.task_attachments.data is distinct from excluded.data
      then now()
      else public.task_attachments.updated_at
    end;
end;
$$;

revoke all on function public.sync_normalized_task_attachments(text, jsonb) from public, anon, authenticated;

create or replace function public.sync_normalized_task_attachments_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_normalized_task_attachments(new.id, new.data);
  return new;
end;
$$;

drop trigger if exists tasks_normalized_attachments_insert_trigger on public.tasks;
create trigger tasks_normalized_attachments_insert_trigger
after insert on public.tasks
for each row execute function public.sync_normalized_task_attachments_trigger();

drop trigger if exists tasks_normalized_attachments_update_trigger on public.tasks;
create trigger tasks_normalized_attachments_update_trigger
after update of data on public.tasks
for each row
when (old.data->'attachments' is distinct from new.data->'attachments')
execute function public.sync_normalized_task_attachments_trigger();

create or replace function public.save_task_with_attachments(
  p_task_id text,
  p_task_data jsonb,
  p_expected_version bigint,
  p_expected_attachment_versions jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  actor_app_user_id text;
  target_project_id text;
  project_data jsonb;
  current_version bigint;
  next_version bigint;
  expected_count integer;
  current_count integer;
  attachment_versions jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if coalesce(p_task_id, '') = '' or jsonb_typeof(coalesce(p_task_data, '{}'::jsonb)) <> 'object' then
    raise exception 'Task id and data are required.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_expected_attachment_versions, '{}'::jsonb)) <> 'object' then
    raise exception 'Expected attachment versions must be an object.' using errcode = '22023';
  end if;

  select app_user->>'id', app_user->>'role'
    into actor_app_user_id, actor_role
    from public.settings app_settings,
      jsonb_array_elements(coalesce(app_settings.data->'users', '[]'::jsonb)) app_user
    where app_settings.id = 'app_settings'
      and lower(coalesce(app_user->>'email', '')) = lower(coalesce(auth.jwt()->>'email', ''))
    limit 1;
  if coalesce(actor_role, '') not in ('Admin', 'Edit') then
    raise exception 'You do not have permission to edit tasks.' using errcode = '42501';
  end if;

  target_project_id := coalesce(p_task_data->>'projectId', '');
  if actor_role = 'Edit' and target_project_id <> '' then
    select data into project_data from public.projects where id = target_project_id;
    if jsonb_array_length(coalesce(project_data->'accessUserIds', '[]'::jsonb)) > 0
      and not exists (
        select 1
        from jsonb_array_elements_text(coalesce(project_data->'accessUserIds', '[]'::jsonb)) access_id
        where access_id = actor_app_user_id
      ) then
      raise exception 'You do not have access to this project.' using errcode = '42501';
    end if;
  end if;

  select version into current_version
  from public.tasks
  where id = p_task_id
  for update;

  if coalesce(p_expected_version, 0) = 0 then
    if current_version is not null then
      raise exception 'VERSION_CONFLICT:tasks:%', p_task_id using errcode = '40001';
    end if;
  elsif current_version is distinct from p_expected_version then
    raise exception 'VERSION_CONFLICT:tasks:%', p_task_id using errcode = '40001';
  end if;

  select count(*) into expected_count from jsonb_object_keys(coalesce(p_expected_attachment_versions, '{}'::jsonb));
  select count(*) into current_count from public.task_attachments where task_id = p_task_id;
  if expected_count <> current_count or exists (
    select 1
    from public.task_attachments attachment
    where attachment.task_id = p_task_id
      and coalesce((p_expected_attachment_versions->>attachment.id)::bigint, -1) <> attachment.version
  ) then
    raise exception 'NORMALIZED_VERSION_CONFLICT:task_attachments:%', p_task_id using errcode = '40001';
  end if;

  if coalesce(p_expected_version, 0) = 0 then
    insert into public.tasks (id, data, version)
    values (p_task_id, p_task_data, 1)
    returning version into next_version;
  else
    update public.tasks
    set data = p_task_data, version = version + 1
    where id = p_task_id and version = p_expected_version
    returning version into next_version;
  end if;

  if next_version is null then
    raise exception 'VERSION_CONFLICT:tasks:%', p_task_id using errcode = '40001';
  end if;

  select coalesce(jsonb_object_agg(id, version), '{}'::jsonb)
    into attachment_versions
    from public.task_attachments
    where task_id = p_task_id;

  return jsonb_build_object(
    'version', next_version,
    'normalizedVersions', jsonb_build_object('attachments', coalesce(attachment_versions, '{}'::jsonb))
  );
end;
$$;

revoke all on function public.save_task_with_attachments(text, jsonb, bigint, jsonb) from public, anon;
grant execute on function public.save_task_with_attachments(text, jsonb, bigint, jsonb) to authenticated;

do $$
declare
  task_row record;
begin
  for task_row in select id, data from public.tasks loop
    perform public.sync_normalized_task_attachments(task_row.id, task_row.data);
  end loop;
end;
$$;

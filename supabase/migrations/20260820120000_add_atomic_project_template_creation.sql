create or replace function public.create_project_from_template(
  p_project jsonb,
  p_tasks jsonb default '[]'::jsonb,
  p_closeout_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  actor_app_user_id text;
  project_id text;
  project_name text;
  task_entry record;
  closeout_entry record;
  task_id text;
  closeout_id text;
  closeout_number text;
  task_data jsonb;
  closeout_data jsonb;
  task_ids jsonb := '[]'::jsonb;
  closeout_ids jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.app_user_can_edit() then
    raise exception 'You do not have permission to create projects.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_project, 'null'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_tasks, 'null'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_closeout_items, 'null'::jsonb)) <> 'array' then
    raise exception 'Project, tasks, and closeout items must use the expected JSON shapes.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_tasks) > 250 or jsonb_array_length(p_closeout_items) > 250 then
    raise exception 'A project template can create at most 250 tasks and 250 closeout items.' using errcode = '22023';
  end if;

  actor_role := public.current_app_user_role();
  actor_app_user_id := public.current_app_user_id();
  project_id := btrim(coalesce(p_project->>'id', ''));
  project_name := btrim(coalesce(p_project->>'name', ''));
  if project_id = '' or length(project_id) > 160 or project_name = '' or length(project_name) > 240 then
    raise exception 'A valid project id and name are required.' using errcode = '22023';
  end if;
  if p_project ? 'accessUserIds'
    and jsonb_typeof(p_project->'accessUserIds') <> 'array' then
    raise exception 'Project access user ids must be an array.' using errcode = '22023';
  end if;
  if exists (select 1 from public.projects where id = project_id) then
    raise exception 'VERSION_CONFLICT:projects:%', project_id using errcode = '40001';
  end if;
  if actor_role = 'Edit'
    and jsonb_array_length(coalesce(p_project->'accessUserIds', '[]'::jsonb)) > 0
    and not exists (
      select 1
      from jsonb_array_elements_text(coalesce(p_project->'accessUserIds', '[]'::jsonb)) access_id
      where access_id = actor_app_user_id
    ) then
    raise exception 'Editors must retain access to projects they create.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_tasks) item
    where jsonb_typeof(item) <> 'object'
      or btrim(coalesce(item->>'id', '')) = ''
      or btrim(coalesce(item->>'label', '')) = ''
      or length(btrim(coalesce(item->>'id', ''))) > 160
      or length(btrim(coalesce(item->>'label', ''))) > 500
      or (item ? 'assignees' and jsonb_typeof(item->'assignees') <> 'array')
  ) or exists (
    select item->>'id'
    from jsonb_array_elements(p_tasks) item
    group by item->>'id'
    having count(*) > 1
  ) then
    raise exception 'Every template task requires a unique id and label.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.tasks
    where id in (select item->>'id' from jsonb_array_elements(p_tasks) item)
  ) then
    raise exception 'A generated template task id is already in use.' using errcode = '40001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_closeout_items) item
    where jsonb_typeof(item) <> 'object'
      or btrim(coalesce(item->>'id', '')) = ''
      or btrim(coalesce(item->>'title', '')) = ''
      or length(btrim(coalesce(item->>'id', ''))) > 160
      or length(btrim(coalesce(item->>'title', ''))) > 240
  ) or exists (
    select item->>'id'
    from jsonb_array_elements(p_closeout_items) item
    group by item->>'id'
    having count(*) > 1
  ) then
    raise exception 'Every template closeout item requires a unique id and title.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.project_closeout_items
    where id in (select item->>'id' from jsonb_array_elements(p_closeout_items) item)
  ) then
    raise exception 'A generated template closeout id is already in use.' using errcode = '40001';
  end if;

  insert into public.projects (id, data, version)
  values (project_id, p_project, 1);
  perform public.sync_explicit_project_sections(project_id, p_project);

  for task_entry in
    select value as item, ordinality
    from jsonb_array_elements(p_tasks) with ordinality
  loop
    task_id := btrim(task_entry.item->>'id');
    task_data := task_entry.item || jsonb_build_object(
      'id', task_id,
      'projectId', project_id,
      'done', false,
      'sourceSelectionId', '',
      'sourceSelectionProjectId', '',
      'sourceSelectionLabel', '',
      'attachments', '[]'::jsonb,
      'createdAt', now()
    );
    insert into public.tasks (id, data, version) values (task_id, task_data, 1);
    perform public.sync_explicit_task_sections(task_id, task_data);
    task_ids := task_ids || jsonb_build_array(task_id);
  end loop;

  for closeout_entry in
    select value as item, ordinality
    from jsonb_array_elements(p_closeout_items) with ordinality
  loop
    closeout_id := btrim(closeout_entry.item->>'id');
    closeout_number := 'CLS-' || lpad(closeout_entry.ordinality::text, 3, '0');
    closeout_data := closeout_entry.item || jsonb_build_object(
      'id', closeout_id,
      'projectId', project_id,
      'number', closeout_number,
      'status', 'not_started',
      'completedDate', '',
      'attachments', '[]'::jsonb,
      'deletedAttachments', '[]'::jsonb
    );
    insert into public.project_closeout_items (
      id, project_id, item_number, title, status, data, version
    ) values (
      closeout_id,
      project_id,
      closeout_number,
      btrim(closeout_entry.item->>'title'),
      'not_started',
      closeout_data,
      1
    );
    closeout_ids := closeout_ids || jsonb_build_array(closeout_id);
  end loop;

  return jsonb_build_object(
    'projectId', project_id,
    'projectVersion', 1,
    'taskIds', task_ids,
    'closeoutIds', closeout_ids
  );
end;
$$;

revoke all on function public.create_project_from_template(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.create_project_from_template(jsonb, jsonb, jsonb) to authenticated;

comment on function public.create_project_from_template(jsonb, jsonb, jsonb) is
  'Atomically creates one project and its attachment-free template tasks and closeout checklist under existing app-role authorization.';

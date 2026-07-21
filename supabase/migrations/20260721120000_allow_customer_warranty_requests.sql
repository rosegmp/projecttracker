-- Allow Customer portal accounts to submit and view only their own warranty
-- requests for assigned projects. Staff-controlled fields remain server-owned.

create or replace function public.list_customer_warranty_requests(p_project_id text)
returns setof public.project_warranty_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_app_user_role() <> 'Customer' then
    raise exception 'Only Customer accounts can use this warranty-request action.' using errcode = '42501';
  end if;
  if not public.app_user_can_view_project(p_project_id) then
    raise exception 'Customer is not assigned to this project.' using errcode = '42501';
  end if;

  return query
  select
    item.id,
    item.project_id,
    item.item_number,
    item.title,
    item.status,
    item.data - array['notes', 'responsibleId', 'responsibleName', 'attachments', 'warrantyEndDate']::text[],
    item.version,
    item.created_by,
    null::uuid,
    item.created_at,
    item.updated_at
  from public.project_warranty_items item
  where item.project_id = p_project_id
    and item.created_by = auth.uid()
    and coalesce(item.data->>'submissionSource', '') = 'customer'
  order by item.updated_at desc;
end;
$$;

create or replace function public.submit_customer_warranty_request(
  p_project_id text,
  p_title text,
  p_category text,
  p_priority text,
  p_description text
)
returns setof public.project_warranty_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text := public.current_app_user_role();
  actor_email text := left(coalesce(auth.jwt()->>'email', 'Customer'), 255);
  clean_title text := left(trim(coalesce(p_title, '')), 255);
  clean_description text := left(trim(coalesce(p_description, '')), 10000);
  clean_category text := coalesce(nullif(trim(p_category), ''), 'General');
  clean_priority text := lower(coalesce(nullif(trim(p_priority), ''), 'normal'));
  next_number integer;
  next_id text := 'warranty-' || gen_random_uuid()::text;
begin
  if actor_role <> 'Customer' then
    raise exception 'Only Customer accounts can use this warranty-request action.' using errcode = '42501';
  end if;
  if not public.app_user_can_view_project(p_project_id) then
    raise exception 'Customer is not assigned to this project.' using errcode = '42501';
  end if;
  if length(clean_title) < 3 then
    raise exception 'Enter a warranty request title.' using errcode = '22023';
  end if;
  if length(clean_description) < 3 then
    raise exception 'Describe the warranty concern.' using errcode = '22023';
  end if;
  if clean_category not in ('General', 'Exterior', 'Interior', 'Mechanical', 'Electrical', 'Plumbing', 'Appliances', 'Other') then
    raise exception 'Invalid warranty category.' using errcode = '22023';
  end if;
  if clean_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Invalid warranty priority.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('customer-warranty:' || p_project_id));
  select coalesce(max(substring(item_number from '([0-9]+)$')::integer), 0) + 1
  into next_number
  from public.project_warranty_items
  where project_id = p_project_id
    and item_number ~ '^WAR-[0-9]+$';

  return query
  insert into public.project_warranty_items (id, project_id, item_number, title, status, data, created_by, updated_by)
  values (
    next_id,
    p_project_id,
    'WAR-' || lpad(next_number::text, 3, '0'),
    clean_title,
    'open',
    jsonb_build_object(
      'id', next_id,
      'projectId', p_project_id,
      'number', 'WAR-' || lpad(next_number::text, 3, '0'),
      'title', clean_title,
      'status', 'open',
      'category', clean_category,
      'priority', clean_priority,
      'reportedBy', actor_email,
      'reportedDate', current_date::text,
      'description', clean_description,
      'responsibleId', '',
      'responsibleName', '',
      'dueDate', '',
      'scheduledDate', '',
      'completedDate', '',
      'warrantyEndDate', '',
      'resolution', '',
      'notes', '',
      'attachments', jsonb_build_array(),
      'submissionSource', 'customer'
    ),
    auth.uid(),
    auth.uid()
  )
  returning *;
end;
$$;

revoke all on function public.list_customer_warranty_requests(text) from public, anon;
revoke all on function public.submit_customer_warranty_request(text, text, text, text, text) from public, anon;
grant execute on function public.list_customer_warranty_requests(text) to authenticated;
grant execute on function public.submit_customer_warranty_request(text, text, text, text, text) to authenticated;

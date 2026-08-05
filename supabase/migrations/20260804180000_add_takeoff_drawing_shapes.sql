alter table public.project_takeoff_markups
  drop constraint if exists project_takeoff_markups_type_check;

alter table public.project_takeoff_markups
  add constraint project_takeoff_markups_type_check
  check (type in ('pen', 'highlight', 'text', 'line', 'multiline', 'rectangle', 'oval'));

alter table public.project_takeoff_markups
  add column if not exists line_width numeric not null default 3
  check (line_width >= 1 and line_width <= 24);

create or replace function public.save_project_takeoff_normalized(
  p_takeoff jsonb,
  p_sheets jsonb,
  p_measurements jsonb,
  p_markups jsonb,
  p_expected_version bigint default null
)
returns setof public.project_takeoffs
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_takeoff_id text := nullif(trim(p_takeoff->>'id'), '');
  v_project_id text := nullif(trim(p_takeoff->>'project_id'), '');
  current_version bigint;
  next_version bigint;
  item jsonb;
  item_page integer;
begin
  if v_takeoff_id is null or v_project_id is null then
    raise exception using errcode = '22023', message = 'takeoff_id_and_project_id_required';
  end if;
  if not public.app_user_can_edit_project(v_project_id) then
    raise exception using errcode = '42501', message = 'takeoff_edit_forbidden';
  end if;
  if jsonb_typeof(coalesce(p_sheets, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_measurements, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_markups, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'takeoff_children_must_be_arrays';
  end if;

  select version into current_version
  from public.project_takeoffs
  where id = v_takeoff_id and project_id = v_project_id
  for update;

  if found then
    if p_expected_version is null or p_expected_version <> current_version then
      raise exception using errcode = '40001', message = 'takeoff_version_conflict';
    end if;
    next_version := current_version + 1;
    update public.project_takeoffs
    set name = p_takeoff->>'name',
        pdf_name = p_takeoff->>'pdf_name',
        storage_bucket = p_takeoff->>'storage_bucket',
        storage_path = p_takeoff->>'storage_path',
        snapshot = coalesce(p_takeoff->'snapshot', '{}'::jsonb),
        version = next_version
    where id = v_takeoff_id and project_id = v_project_id;
  else
    if p_expected_version is not null then
      raise exception using errcode = '40001', message = 'takeoff_version_conflict';
    end if;
    next_version := 1;
    insert into public.project_takeoffs (
      id, project_id, name, pdf_name, storage_bucket, storage_path, snapshot, version
    ) values (
      v_takeoff_id,
      v_project_id,
      p_takeoff->>'name',
      p_takeoff->>'pdf_name',
      p_takeoff->>'storage_bucket',
      p_takeoff->>'storage_path',
      coalesce(p_takeoff->'snapshot', '{}'::jsonb),
      next_version
    );
  end if;

  delete from public.project_takeoff_measurements
  where takeoff_id = v_takeoff_id and project_id = v_project_id;
  delete from public.project_takeoff_markups
  where takeoff_id = v_takeoff_id and project_id = v_project_id;
  delete from public.project_takeoff_sheets
  where takeoff_id = v_takeoff_id and project_id = v_project_id;

  for item in select value from jsonb_array_elements(coalesce(p_sheets, '[]'::jsonb))
  loop
    item_page := (item->>'page_number')::integer;
    insert into public.project_takeoff_sheets (
      takeoff_id, project_id, page_number, name, scale
    ) values (
      v_takeoff_id, v_project_id, item_page,
      coalesce(nullif(item->>'name', ''), 'Sheet ' || item_page),
      item->'scale'
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_measurements, '[]'::jsonb))
  loop
    insert into public.project_takeoff_measurements (
      takeoff_id, project_id, id, page_number, type, label, color, symbol, points, source_created_at
    ) values (
      v_takeoff_id, v_project_id, item->>'id', (item->>'page_number')::integer,
      item->>'type', coalesce(item->>'label', ''), coalesce(item->>'color', ''),
      coalesce(item->>'symbol', ''), coalesce(item->'points', '[]'::jsonb),
      nullif(item->>'source_created_at', '')::timestamptz
    );
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_markups, '[]'::jsonb))
  loop
    insert into public.project_takeoff_markups (
      takeoff_id, project_id, id, page_number, type, text, color, line_width, points, source_created_at
    ) values (
      v_takeoff_id, v_project_id, item->>'id', (item->>'page_number')::integer,
      item->>'type', coalesce(item->>'text', ''), coalesce(item->>'color', ''),
      least(24, greatest(1, coalesce((item->>'line_width')::numeric, 3))),
      coalesce(item->'points', '[]'::jsonb),
      nullif(item->>'source_created_at', '')::timestamptz
    );
  end loop;

  return query
  select * from public.project_takeoffs
  where id = v_takeoff_id and project_id = v_project_id;
end;
$$;

revoke all on function public.save_project_takeoff_normalized(jsonb, jsonb, jsonb, jsonb, bigint)
  from public, anon;
grant execute on function public.save_project_takeoff_normalized(jsonb, jsonb, jsonb, jsonb, bigint)
  to authenticated;

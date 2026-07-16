create or replace function public.save_normalized_project_task_batch(
  p_project_updates jsonb,
  p_task_operations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  project_update jsonb;
  project_id text;
  sections jsonb;
  non_inspection_sections jsonb;
  expected_versions jsonb;
  section_result jsonb;
  inspection_result jsonb;
  combined_versions jsonb;
  project_version bigint;
  project_results jsonb := '[]'::jsonb;
  task_results jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.app_user_can_edit() then
    raise exception 'You do not have permission to edit tracker records.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_project_updates, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_task_operations, '[]'::jsonb)) <> 'array' then
    raise exception 'Project updates and task operations must be arrays.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_task_operations, '[]'::jsonb)) operation
    where operation->>'table' <> 'tasks'
  ) then
    raise exception 'Normalized project batches only accept task operations.' using errcode = '22023';
  end if;

  for project_update in
    select value from jsonb_array_elements(coalesce(p_project_updates, '[]'::jsonb))
  loop
    project_id := coalesce(project_update->>'id', '');
    sections := coalesce(project_update->'sections', '{}'::jsonb);
    expected_versions := coalesce(project_update->'expectedVersions', '{}'::jsonb);
    if project_id = '' or jsonb_typeof(sections) <> 'object' or jsonb_typeof(expected_versions) <> 'object' then
      raise exception 'Each normalized project update requires an id, sections, and expected versions.' using errcode = '22023';
    end if;
    if not (sections ?| array['phases', 'files', 'photos', 'selections', 'inspections']) then
      raise exception 'No supported normalized project section was supplied.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_object_keys(sections) section_name
      where section_name not in ('phases', 'files', 'photos', 'selections', 'inspections')
    ) then
      raise exception 'Unsupported normalized project section.' using errcode = '22023';
    end if;

    section_result := null;
    inspection_result := null;
    non_inspection_sections := sections - 'inspections';
    if non_inspection_sections <> '{}'::jsonb then
      section_result := public.save_normalized_project_sections(
        project_id,
        non_inspection_sections,
        expected_versions
      );
    end if;
    if sections ? 'inspections' then
      inspection_result := public.save_normalized_project_inspections(
        project_id,
        coalesce(sections->'inspections', '[]'::jsonb),
        expected_versions
      );
    end if;

    project_version := coalesce(
      (inspection_result->>'version')::bigint,
      (section_result->>'version')::bigint,
      0
    );
    combined_versions := coalesce(section_result->'normalizedVersions', '{}'::jsonb)
      || coalesce(inspection_result->'normalizedVersions', '{}'::jsonb);
    project_results := project_results || jsonb_build_array(jsonb_build_object(
      'id', project_id,
      'version', project_version,
      'normalizedVersions', combined_versions
    ));
  end loop;

  if jsonb_array_length(coalesce(p_task_operations, '[]'::jsonb)) > 0 then
    task_results := public.apply_tracker_batch(p_task_operations);
  end if;

  return jsonb_build_object(
    'projectResults', project_results,
    'taskResults', task_results
  );
end;
$$;

revoke all on function public.save_normalized_project_task_batch(jsonb, jsonb) from public, anon;
grant execute on function public.save_normalized_project_task_batch(jsonb, jsonb) to authenticated;

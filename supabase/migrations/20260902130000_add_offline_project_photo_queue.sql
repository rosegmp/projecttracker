-- Append project photos through one focused, idempotent operation. This avoids
-- rewriting an entire project when an offline device reconnects.
create or replace function public.add_project_photos(
  p_project_id text,
  p_photos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text := public.current_app_user_role();
  photo jsonb;
  photo_id text;
  photo_name text;
  photo_type text;
  photo_path text;
  normalized_photo jsonb;
  existing_photo public.project_photos%rowtype;
  next_position integer;
  inserted_version bigint;
  result jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not (
    public.app_user_can_edit_project(p_project_id)
    or (actor_role = 'Customer' and public.app_user_can_view_project(p_project_id))
  ) then
    raise exception 'You do not have permission to add photos to this project.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_photos) <> 'array'
    or jsonb_array_length(p_photos) < 1
    or jsonb_array_length(p_photos) > 20 then
    raise exception 'Choose between 1 and 20 photos.' using errcode = '22023';
  end if;

  -- Serialize append positions for concurrent devices.
  perform 1 from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  select coalesce(max(position), -1) + 1
  into next_position
  from public.project_photos
  where project_id = p_project_id;

  for photo in select value from jsonb_array_elements(p_photos)
  loop
    photo_id := nullif(photo->>'id', '');
    photo_name := left(coalesce(nullif(photo->>'name', ''), nullif(photo->>'originalName', ''), 'Project photo'), 255);
    photo_type := lower(coalesce(photo->>'type', ''));
    photo_path := coalesce(photo->>'storagePath', '');

    if photo_id is null or photo_id !~ '^photo-[A-Za-z0-9-]{8,}$' then
      raise exception 'Invalid project photo id.' using errcode = '22023';
    end if;
    if photo_type !~ '^image/' then
      raise exception 'Only image uploads are allowed.' using errcode = '22023';
    end if;
    if coalesce((photo->>'size')::bigint, 0) < 1
      or coalesce((photo->>'size')::bigint, 0) > 52428800 then
      raise exception 'Each photo must be no larger than 50 MB.' using errcode = '22023';
    end if;
    if photo->>'storageBucket' <> 'project-files'
      or photo->>'storageProvider' <> 'supabase'
      or photo_path not like 'projects/' || p_project_id || '/photos/' || photo_id || '-%' then
      raise exception 'Invalid project photo storage path.' using errcode = '22023';
    end if;
    if not exists (
      select 1 from storage.objects object_row
      where object_row.bucket_id = 'project-files' and object_row.name = photo_path
    ) then
      raise exception 'Uploaded photo object was not found.' using errcode = '22023';
    end if;

    normalized_photo := jsonb_build_object(
      'id', photo_id,
      'name', photo_name,
      'originalName', left(coalesce(nullif(photo->>'originalName', ''), photo_name), 255),
      'size', (photo->>'size')::bigint,
      'type', photo_type,
      'uploadedAt', coalesce(nullif(photo->>'uploadedAt', ''), now()::text),
      'storageProvider', 'supabase',
      'storageBucket', 'project-files',
      'storagePath', photo_path,
      'dataUrl', ''
    );

    select * into existing_photo
    from public.project_photos
    where project_id = p_project_id and id = photo_id;
    if found then
      if coalesce(existing_photo.data->>'storagePath', '') <> photo_path then
        raise exception 'A different photo already uses this identifier.' using errcode = '23505';
      end if;
      result := result || jsonb_build_array(existing_photo.data || jsonb_build_object('_version', existing_photo.version));
      continue;
    end if;

    insert into public.project_photos (project_id, id, position, data)
    values (p_project_id, photo_id, next_position, normalized_photo)
    returning version into inserted_version;
    result := result || jsonb_build_array(normalized_photo || jsonb_build_object('_version', inserted_version));
    next_position := next_position + 1;
  end loop;

  return result;
end;
$$;

revoke all on function public.add_project_photos(text, jsonb) from public, anon;
grant execute on function public.add_project_photos(text, jsonb) to authenticated;

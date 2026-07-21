-- Allow Customer portal accounts to add photos to assigned projects without
-- granting broader project, asset-record, or storage mutation access.

drop policy if exists "Customers can upload assigned project photos" on storage.objects;
create policy "Customers can upload assigned project photos" on storage.objects
  for insert to authenticated
  with check (
    public.current_app_user_role() = 'Customer'
    and bucket_id = 'project-files'
    and (storage.foldername(name))[1] = 'projects'
    and public.app_user_can_view_project((storage.foldername(name))[2])
    and (storage.foldername(name))[3] = 'photos'
    and storage.filename(name) like 'photo-%'
  );

create or replace function public.add_customer_project_photos(
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
  next_position integer;
  inserted_version bigint;
  result jsonb := '[]'::jsonb;
begin
  if actor_role <> 'Customer' then
    raise exception 'Only Customer accounts can use this photo-upload action.' using errcode = '42501';
  end if;
  if not public.app_user_can_view_project(p_project_id) then
    raise exception 'Customer is not assigned to this project.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_photos) <> 'array'
    or jsonb_array_length(p_photos) < 1
    or jsonb_array_length(p_photos) > 20 then
    raise exception 'Choose between 1 and 20 photos.' using errcode = '22023';
  end if;

  select coalesce(max(position), -1) + 1
  into next_position
  from public.project_photos
  where project_id = p_project_id;

  for photo in select value from jsonb_array_elements(p_photos)
  loop
    photo_id := nullif(photo->>'id', '');
    photo_name := left(coalesce(nullif(photo->>'name', ''), nullif(photo->>'originalName', ''), 'Customer photo'), 255);
    photo_type := lower(coalesce(photo->>'type', ''));
    photo_path := coalesce(photo->>'storagePath', '');

    if photo_id is null or photo_id !~ '^photo-[A-Za-z0-9-]{8,}$' then
      raise exception 'Invalid customer photo id.' using errcode = '22023';
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
      raise exception 'Invalid customer photo storage path.' using errcode = '22023';
    end if;
    if not exists (
      select 1
      from storage.objects object_row
      where object_row.bucket_id = 'project-files'
        and object_row.name = photo_path
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

    insert into public.project_photos (project_id, id, position, data)
    values (p_project_id, photo_id, next_position, normalized_photo)
    returning version into inserted_version;

    result := result || jsonb_build_array(normalized_photo || jsonb_build_object('version', inserted_version));
    next_position := next_position + 1;
  end loop;

  return result;
end;
$$;

revoke all on function public.add_customer_project_photos(text, jsonb) from public, anon;
grant execute on function public.add_customer_project_photos(text, jsonb) to authenticated;

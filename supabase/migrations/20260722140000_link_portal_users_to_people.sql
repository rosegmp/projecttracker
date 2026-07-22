-- Customer and Subcontractor application users may link to exactly one matching
-- record from the unified People directory. The app user keeps the normalized
-- People id in its data JSON so existing settings synchronization remains authoritative.

create unique index if not exists app_users_linked_person_unique
  on public.app_users ((data->>'personId'))
  where nullif(data->>'personId', '') is not null;

create or replace function public.validate_app_user_person_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_person_id text := nullif(trim(coalesce(new.data->>'personId', '')), '');
  user_role text := coalesce(new.data->>'role', 'View Only');
  expected_people_type text;
begin
  if linked_person_id is null then
    return new;
  end if;
  expected_people_type := case user_role
    when 'Customer' then 'customer'
    when 'Subcontractor' then 'sub'
    else null
  end;
  if expected_people_type is null then
    raise exception 'Only Customer and Subcontractor users can link to People records.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.people person_row
    where person_row.id = linked_person_id and person_row.people_type = expected_people_type
  ) then
    raise exception 'The linked People record does not match the application user role.' using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists app_users_validate_person_link on public.app_users;
create trigger app_users_validate_person_link
before insert or update of data on public.app_users
for each row execute function public.validate_app_user_person_link();

create or replace function public.protect_linked_portal_person()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.app_users app_user
    where app_user.data->>'personId' = old.id
  ) then
    raise exception 'Unlink this person from its application user before deleting the People record.' using errcode = '23503';
  end if;
  return old;
end;
$$;

drop trigger if exists people_protect_linked_customer on public.people;
drop trigger if exists people_protect_linked_portal_person on public.people;
create trigger people_protect_linked_portal_person
before delete on public.people
for each row execute function public.protect_linked_portal_person();

create or replace function public.get_current_app_user_profile()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when app_user.id is null then null else jsonb_build_object(
    'id', app_user.id,
    'name', coalesce(app_user.data->>'name', ''),
    'email', coalesce(app_user.data->>'email', ''),
    'role', coalesce(app_user.data->>'role', 'View Only'),
    'personId', coalesce(app_user.data->>'personId', '')
  ) end
  from (select public.current_app_user_id() as id) current_user_row
  left join public.app_users app_user on app_user.id = current_user_row.id
$$;

revoke all on function public.validate_app_user_person_link() from public, anon, authenticated;
revoke all on function public.protect_linked_portal_person() from public, anon, authenticated;
revoke all on function public.get_current_app_user_profile() from public, anon;
grant execute on function public.get_current_app_user_profile() to authenticated;

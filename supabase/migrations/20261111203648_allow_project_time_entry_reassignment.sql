-- RLS checks edit access to both the existing and replacement project.
-- Keep the recorded owner immutable while allowing that project change.
create or replace function public.set_project_time_entry_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.user_id is distinct from old.user_id or new.user_email is distinct from old.user_email then
    raise exception 'Time entry ownership cannot be changed.' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

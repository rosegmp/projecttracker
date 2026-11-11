create trigger enforce_application_write_freeze
before insert or update or delete on public.project_time_entries
for each statement execute function private.enforce_application_write_freeze();

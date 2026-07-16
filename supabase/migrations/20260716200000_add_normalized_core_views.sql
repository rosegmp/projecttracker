create or replace view public.project_core_records
with (security_invoker = true)
as
select
  id,
  data
    - 'phases'
    - 'files'
    - 'photos'
    - 'selections'
    - 'inspections'
    - 'accessUserIds' as data,
  version,
  created_at
from public.projects;

create or replace view public.task_core_records
with (security_invoker = true)
as
select
  id,
  data
    - 'attachments'
    - 'assignees'
    - 'assignee'
    - 'sourceSelectionId'
    - 'sourceSelectionProjectId'
    - 'sourceSelectionLabel' as data,
  version,
  created_at
from public.tasks;

revoke all on public.project_core_records from public, anon;
revoke all on public.task_core_records from public, anon;
grant select on public.project_core_records to authenticated;
grant select on public.task_core_records to authenticated;

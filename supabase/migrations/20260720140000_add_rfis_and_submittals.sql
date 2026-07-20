create table if not exists public.project_rfis (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  order_number text not null,
  title text not null,
  status text not null default 'open' check (status in ('draft', 'open', 'answered', 'closed', 'cancelled')),
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, order_number)
);

create index if not exists project_rfis_project_updated_idx
  on public.project_rfis (project_id, updated_at desc);

create table if not exists public.project_submittals (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  order_number text not null,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'under_review', 'approved', 'approved_as_noted', 'revise_resubmit', 'rejected', 'closed')),
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, order_number)
);

create index if not exists project_submittals_project_updated_idx
  on public.project_submittals (project_id, updated_at desc);

drop trigger if exists project_rfis_metadata_trigger on public.project_rfis;
create trigger project_rfis_metadata_trigger before insert or update on public.project_rfis
for each row execute function public.set_project_workflow_metadata();
drop trigger if exists project_submittals_metadata_trigger on public.project_submittals;
create trigger project_submittals_metadata_trigger before insert or update on public.project_submittals
for each row execute function public.set_project_workflow_metadata();

alter table public.project_rfis enable row level security;
alter table public.project_submittals enable row level security;

drop policy if exists "Project users can read RFIs" on public.project_rfis;
create policy "Project users can read RFIs" on public.project_rfis for select to authenticated
using (public.app_user_can_view_project(project_id));
drop policy if exists "Project editors can create RFIs" on public.project_rfis;
create policy "Project editors can create RFIs" on public.project_rfis for insert to authenticated
with check (public.app_user_can_edit_project(project_id));
drop policy if exists "Project editors can update RFIs" on public.project_rfis;
create policy "Project editors can update RFIs" on public.project_rfis for update to authenticated
using (public.app_user_can_edit_project(project_id)) with check (public.app_user_can_edit_project(project_id));
drop policy if exists "Project editors can delete RFIs" on public.project_rfis;
create policy "Project editors can delete RFIs" on public.project_rfis for delete to authenticated
using (public.app_user_can_edit_project(project_id));

drop policy if exists "Project users can read submittals" on public.project_submittals;
create policy "Project users can read submittals" on public.project_submittals for select to authenticated
using (public.app_user_can_view_project(project_id));
drop policy if exists "Project editors can create submittals" on public.project_submittals;
create policy "Project editors can create submittals" on public.project_submittals for insert to authenticated
with check (public.app_user_can_edit_project(project_id));
drop policy if exists "Project editors can update submittals" on public.project_submittals;
create policy "Project editors can update submittals" on public.project_submittals for update to authenticated
using (public.app_user_can_edit_project(project_id)) with check (public.app_user_can_edit_project(project_id));
drop policy if exists "Project editors can delete submittals" on public.project_submittals;
create policy "Project editors can delete submittals" on public.project_submittals for delete to authenticated
using (public.app_user_can_edit_project(project_id));

revoke all on public.project_rfis, public.project_submittals from anon;
grant select, insert, update, delete on public.project_rfis, public.project_submittals to authenticated;

alter table public.audit_events drop constraint if exists audit_events_entity_type_check;
alter table public.audit_events add constraint audit_events_entity_type_check
check (entity_type in ('project', 'task', 'takeoff', 'daily_log', 'change_order', 'rfi', 'submittal'));

create or replace function public.record_project_document_workflow_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  before_row jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  after_row jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  source_row jsonb := coalesce(after_row, before_row);
  entity_kind text := case when tg_table_name = 'project_rfis' then 'rfi' else 'submittal' end;
  entity_name text := coalesce(source_row->>'order_number', source_row->>'title', 'Project document');
begin
  insert into public.audit_events (actor_user_id, actor_email, entity_type, entity_id, project_id, action, before_data, after_data)
  values (
    auth.uid(), coalesce(auth.jwt()->>'email', ''), entity_kind, source_row->>'id', source_row->>'project_id', lower(tg_op),
    case when before_row is null then null else jsonb_build_object('id', before_row->>'id', 'name', entity_name, 'status', before_row->>'status', 'version', before_row->>'version') end,
    case when after_row is null then null else jsonb_build_object('id', after_row->>'id', 'name', entity_name, 'status', after_row->>'status', 'version', after_row->>'version') end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists project_rfis_audit_trigger on public.project_rfis;
create trigger project_rfis_audit_trigger after insert or update or delete on public.project_rfis
for each row execute function public.record_project_document_workflow_audit_event();
drop trigger if exists project_submittals_audit_trigger on public.project_submittals;
create trigger project_submittals_audit_trigger after insert or update or delete on public.project_submittals
for each row execute function public.record_project_document_workflow_audit_event();

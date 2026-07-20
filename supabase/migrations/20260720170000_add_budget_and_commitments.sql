create table if not exists public.project_budget_items (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  item_code text not null,
  title text not null,
  status text not null default 'active' check (status in ('planned', 'active', 'closed')),
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, item_code)
);

create index if not exists project_budget_items_project_code_idx
  on public.project_budget_items (project_id, item_code, updated_at desc);

create table if not exists public.project_commitments (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  commitment_number text not null,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'proposed', 'approved', 'issued', 'complete', 'void')),
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, commitment_number)
);

create index if not exists project_commitments_project_updated_idx
  on public.project_commitments (project_id, updated_at desc);

drop trigger if exists project_budget_items_metadata_trigger on public.project_budget_items;
create trigger project_budget_items_metadata_trigger before insert or update on public.project_budget_items
for each row execute function public.set_project_workflow_metadata();
drop trigger if exists project_commitments_metadata_trigger on public.project_commitments;
create trigger project_commitments_metadata_trigger before insert or update on public.project_commitments
for each row execute function public.set_project_workflow_metadata();

alter table public.project_budget_items enable row level security;
alter table public.project_commitments enable row level security;

drop policy if exists "Project users can read budget items" on public.project_budget_items;
create policy "Project users can read budget items" on public.project_budget_items for select to authenticated
using (public.app_user_can_view_project(project_id));
drop policy if exists "Project editors can create budget items" on public.project_budget_items;
create policy "Project editors can create budget items" on public.project_budget_items for insert to authenticated
with check (public.app_user_can_edit_project(project_id));
drop policy if exists "Project editors can update budget items" on public.project_budget_items;
create policy "Project editors can update budget items" on public.project_budget_items for update to authenticated
using (public.app_user_can_edit_project(project_id)) with check (public.app_user_can_edit_project(project_id));
drop policy if exists "Project editors can delete budget items" on public.project_budget_items;
create policy "Project editors can delete budget items" on public.project_budget_items for delete to authenticated
using (public.app_user_can_edit_project(project_id));

drop policy if exists "Project users can read commitments" on public.project_commitments;
create policy "Project users can read commitments" on public.project_commitments for select to authenticated
using (public.app_user_can_view_project(project_id));
drop policy if exists "Project editors can create commitments" on public.project_commitments;
create policy "Project editors can create commitments" on public.project_commitments for insert to authenticated
with check (public.app_user_can_edit_project(project_id));
drop policy if exists "Project editors can update commitments" on public.project_commitments;
create policy "Project editors can update commitments" on public.project_commitments for update to authenticated
using (public.app_user_can_edit_project(project_id)) with check (public.app_user_can_edit_project(project_id));
drop policy if exists "Project editors can delete commitments" on public.project_commitments;
create policy "Project editors can delete commitments" on public.project_commitments for delete to authenticated
using (public.app_user_can_edit_project(project_id));

revoke all on public.project_budget_items, public.project_commitments from anon;
grant select, insert, update, delete on public.project_budget_items, public.project_commitments to authenticated;

alter table public.audit_events drop constraint if exists audit_events_entity_type_check;
alter table public.audit_events add constraint audit_events_entity_type_check
check (entity_type in ('project', 'task', 'takeoff', 'daily_log', 'change_order', 'rfi', 'submittal', 'budget_item', 'commitment'));

create or replace function public.record_project_financial_workflow_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  before_row jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  after_row jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  source_row jsonb := coalesce(after_row, before_row);
  entity_kind text := case when tg_table_name = 'project_budget_items' then 'budget_item' else 'commitment' end;
  entity_name text := coalesce(source_row->>'item_code', source_row->>'commitment_number', source_row->>'title', 'Financial workflow');
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

drop trigger if exists project_budget_items_audit_trigger on public.project_budget_items;
create trigger project_budget_items_audit_trigger after insert or update or delete on public.project_budget_items
for each row execute function public.record_project_financial_workflow_audit_event();
drop trigger if exists project_commitments_audit_trigger on public.project_commitments;
create trigger project_commitments_audit_trigger after insert or update or delete on public.project_commitments
for each row execute function public.record_project_financial_workflow_audit_event();

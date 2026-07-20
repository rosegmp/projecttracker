create table if not exists public.project_daily_logs (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  log_date date not null,
  title text not null default 'Daily log',
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_daily_logs_project_date_idx
  on public.project_daily_logs (project_id, log_date desc, updated_at desc);

create table if not exists public.project_change_orders (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  order_number text not null,
  title text not null,
  status text not null default 'proposed' check (status in ('draft', 'proposed', 'approved', 'rejected', 'void')),
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, order_number)
);

create index if not exists project_change_orders_project_updated_idx
  on public.project_change_orders (project_id, updated_at desc);

create or replace function public.set_project_workflow_metadata()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then new.version := old.version + 1; end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  return new;
end;
$$;

drop trigger if exists project_daily_logs_metadata_trigger on public.project_daily_logs;
create trigger project_daily_logs_metadata_trigger before insert or update on public.project_daily_logs
for each row execute function public.set_project_workflow_metadata();
drop trigger if exists project_change_orders_metadata_trigger on public.project_change_orders;
create trigger project_change_orders_metadata_trigger before insert or update on public.project_change_orders
for each row execute function public.set_project_workflow_metadata();

alter table public.project_daily_logs enable row level security;
alter table public.project_change_orders enable row level security;

drop policy if exists "Project users can read daily logs" on public.project_daily_logs;
create policy "Project users can read daily logs" on public.project_daily_logs for select to authenticated
using (public.app_user_can_view_project(project_id));
drop policy if exists "Project editors can create daily logs" on public.project_daily_logs;
create policy "Project editors can create daily logs" on public.project_daily_logs for insert to authenticated
with check (public.app_user_can_edit_project(project_id));
drop policy if exists "Project editors can update daily logs" on public.project_daily_logs;
create policy "Project editors can update daily logs" on public.project_daily_logs for update to authenticated
using (public.app_user_can_edit_project(project_id)) with check (public.app_user_can_edit_project(project_id));
drop policy if exists "Project editors can delete daily logs" on public.project_daily_logs;
create policy "Project editors can delete daily logs" on public.project_daily_logs for delete to authenticated
using (public.app_user_can_edit_project(project_id));

drop policy if exists "Project users can read change orders" on public.project_change_orders;
create policy "Project users can read change orders" on public.project_change_orders for select to authenticated
using (public.app_user_can_view_project(project_id));
drop policy if exists "Project editors can create change orders" on public.project_change_orders;
create policy "Project editors can create change orders" on public.project_change_orders for insert to authenticated
with check (public.app_user_can_edit_project(project_id));
drop policy if exists "Project editors can update change orders" on public.project_change_orders;
create policy "Project editors can update change orders" on public.project_change_orders for update to authenticated
using (public.app_user_can_edit_project(project_id)) with check (public.app_user_can_edit_project(project_id));
drop policy if exists "Project editors can delete change orders" on public.project_change_orders;
create policy "Project editors can delete change orders" on public.project_change_orders for delete to authenticated
using (public.app_user_can_edit_project(project_id));

revoke all on public.project_daily_logs, public.project_change_orders from anon;
grant select, insert, update, delete on public.project_daily_logs, public.project_change_orders to authenticated;

alter table public.audit_events drop constraint if exists audit_events_entity_type_check;
alter table public.audit_events add constraint audit_events_entity_type_check
check (entity_type in ('project', 'task', 'takeoff', 'daily_log', 'change_order'));

create or replace function public.record_project_workflow_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  before_row jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  after_row jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  source_row jsonb := coalesce(after_row, before_row);
  entity_kind text := case when tg_table_name = 'project_daily_logs' then 'daily_log' else 'change_order' end;
  entity_name text;
begin
  entity_name := coalesce(source_row->>'title', source_row->>'order_number', 'Project workflow');
  insert into public.audit_events (actor_user_id, actor_email, entity_type, entity_id, project_id, action, before_data, after_data)
  values (
    auth.uid(), coalesce(auth.jwt()->>'email', ''), entity_kind, source_row->>'id', source_row->>'project_id', lower(tg_op),
    case when before_row is null then null else jsonb_build_object('id', before_row->>'id', 'name', entity_name, 'status', before_row->>'status', 'date', before_row->>'log_date', 'version', before_row->>'version') end,
    case when after_row is null then null else jsonb_build_object('id', after_row->>'id', 'name', entity_name, 'status', after_row->>'status', 'date', after_row->>'log_date', 'version', after_row->>'version') end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists project_daily_logs_audit_trigger on public.project_daily_logs;
create trigger project_daily_logs_audit_trigger after insert or update or delete on public.project_daily_logs
for each row execute function public.record_project_workflow_audit_event();
drop trigger if exists project_change_orders_audit_trigger on public.project_change_orders;
create trigger project_change_orders_audit_trigger after insert or update or delete on public.project_change_orders
for each row execute function public.record_project_workflow_audit_event();

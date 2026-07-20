create table if not exists public.project_portal_items (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  item_number text not null,
  title text not null,
  item_type text not null default 'update' check (item_type in ('update', 'request', 'approval')),
  audience text not null default 'all' check (audience in ('all', 'customer', 'subcontractor')),
  status text not null default 'published' check (status in ('draft', 'published', 'response_requested', 'answered', 'approved', 'declined', 'closed')),
  due_date date,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, item_number)
);

create index if not exists project_portal_items_project_updated_idx
  on public.project_portal_items (project_id, updated_at desc);

drop trigger if exists project_portal_items_metadata_trigger on public.project_portal_items;
create trigger project_portal_items_metadata_trigger before insert or update on public.project_portal_items
for each row execute function public.set_project_workflow_metadata();

alter table public.project_portal_items enable row level security;

drop policy if exists "Project users can read portal items" on public.project_portal_items;
create policy "Project users can read portal items" on public.project_portal_items for select to authenticated
using (
  public.app_user_can_view_project(project_id)
  and (
    public.current_app_user_role() in ('Admin', 'Edit', 'View Only')
    or audience = 'all'
    or audience = lower(public.current_app_user_role())
  )
);

drop policy if exists "Project editors can create portal items" on public.project_portal_items;
create policy "Project editors can create portal items" on public.project_portal_items for insert to authenticated
with check (public.app_user_can_edit_project(project_id));

drop policy if exists "Project editors can update portal items" on public.project_portal_items;
create policy "Project editors can update portal items" on public.project_portal_items for update to authenticated
using (public.app_user_can_edit_project(project_id))
with check (public.app_user_can_edit_project(project_id));

drop policy if exists "Project editors can delete portal items" on public.project_portal_items;
create policy "Project editors can delete portal items" on public.project_portal_items for delete to authenticated
using (public.app_user_can_edit_project(project_id));

revoke all on public.project_portal_items from anon;
grant select, insert, update, delete on public.project_portal_items to authenticated;

create or replace function public.respond_to_project_portal_item(
  p_item_id text,
  p_version bigint,
  p_response text,
  p_decision text default ''
)
returns setof public.project_portal_items
language plpgsql
security definer
set search_path = public
as $$
declare
  portal_row public.project_portal_items%rowtype;
  actor_role text := public.current_app_user_role();
  decision text := lower(coalesce(p_decision, ''));
begin
  if actor_role not in ('Customer', 'Subcontractor') then
    raise exception 'Only customer or subcontractor portal users can use this response action';
  end if;
  if decision not in ('', 'answered', 'approved', 'declined') then
    raise exception 'Unsupported portal response decision';
  end if;

  select * into portal_row
  from public.project_portal_items
  where id = p_item_id
    and version = p_version
  for update;

  if not found then
    raise exception 'This portal item changed elsewhere. Reopen it before responding.';
  end if;
  if not public.app_user_can_view_project(portal_row.project_id)
    or portal_row.audience not in ('all', lower(actor_role)) then
    raise exception 'You do not have access to this portal item';
  end if;
  if portal_row.status in ('draft', 'closed') then
    raise exception 'This portal item is not accepting responses';
  end if;

  return query
  update public.project_portal_items
  set data = coalesce(data, '{}'::jsonb) || jsonb_build_object(
        'response', trim(coalesce(p_response, '')),
        'responseByUserId', public.current_app_user_id(),
        'responseByRole', actor_role,
        'respondedAt', now()
      ),
      status = case when decision in ('approved', 'declined') then decision else 'answered' end,
      updated_by = auth.uid()
  where id = portal_row.id
  returning *;
end;
$$;

revoke all on function public.respond_to_project_portal_item(text, bigint, text, text) from public, anon;
grant execute on function public.respond_to_project_portal_item(text, bigint, text, text) to authenticated;

alter table public.audit_events drop constraint if exists audit_events_entity_type_check;
alter table public.audit_events add constraint audit_events_entity_type_check
check (entity_type in ('project', 'task', 'takeoff', 'daily_log', 'change_order', 'rfi', 'submittal', 'budget_item', 'commitment', 'portal_item'));

create or replace function public.record_project_portal_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  before_row jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  after_row jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  source_row jsonb := coalesce(after_row, before_row);
begin
  insert into public.audit_events (actor_user_id, actor_email, entity_type, entity_id, project_id, action, before_data, after_data)
  values (
    auth.uid(), coalesce(auth.jwt()->>'email', ''), 'portal_item', source_row->>'id', source_row->>'project_id', lower(tg_op),
    case when before_row is null then null else jsonb_build_object('id', before_row->>'id', 'name', before_row->>'item_number', 'status', before_row->>'status', 'version', before_row->>'version') end,
    case when after_row is null then null else jsonb_build_object('id', after_row->>'id', 'name', after_row->>'item_number', 'status', after_row->>'status', 'version', after_row->>'version') end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists project_portal_items_audit_trigger on public.project_portal_items;
create trigger project_portal_items_audit_trigger after insert or update or delete on public.project_portal_items
for each row execute function public.record_project_portal_audit_event();

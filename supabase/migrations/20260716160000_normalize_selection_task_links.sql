create table if not exists public.selection_task_links (
  project_id text not null,
  selection_id text not null,
  task_id text not null references public.tasks(id) on delete cascade,
  position integer not null default 0,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, selection_id, task_id),
  foreign key (project_id, selection_id)
    references public.project_selections(project_id, id) on delete cascade
);

create index if not exists selection_task_links_task_idx on public.selection_task_links (task_id);

alter table public.selection_task_links enable row level security;
drop policy if exists "App users can read selection task links" on public.selection_task_links;
create policy "App users can read selection task links" on public.selection_task_links
  for select to authenticated using (auth.uid() is not null);

revoke insert, update, delete on public.selection_task_links from anon, authenticated;
grant select on public.selection_task_links to authenticated;

create or replace function public.sync_normalized_selection_task_links(
  p_project_id text,
  p_selection_id text,
  p_selection_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  task_ids jsonb := case
    when jsonb_typeof(p_selection_data->'taskIds') = 'array' then p_selection_data->'taskIds'
    else '[]'::jsonb
  end;
begin
  delete from public.selection_task_links existing
  where existing.project_id = p_project_id and existing.selection_id = p_selection_id
    and not exists (
      select 1
      from jsonb_array_elements_text(task_ids) value
      join public.tasks task on task.id = trim(value)
      where task.id = existing.task_id
    );

  insert into public.selection_task_links (project_id, selection_id, task_id, position)
  select p_project_id, p_selection_id, trim(value), min(position)::integer - 1
  from jsonb_array_elements_text(task_ids) with ordinality source(value, position)
  join public.tasks task on task.id = trim(value)
  where trim(value) <> ''
  group by trim(value)
  on conflict (project_id, selection_id, task_id) do update set
    position = excluded.position,
    version = case when public.selection_task_links.position is distinct from excluded.position
      then public.selection_task_links.version + 1 else public.selection_task_links.version end,
    updated_at = case when public.selection_task_links.position is distinct from excluded.position
      then now() else public.selection_task_links.updated_at end;
end;
$$;

revoke all on function public.sync_normalized_selection_task_links(text, text, jsonb) from public, anon, authenticated;

create or replace function public.sync_normalized_selection_task_links_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_normalized_selection_task_links(new.project_id, new.id, new.data);
  return new;
end;
$$;

drop trigger if exists selections_normalized_task_links_trigger on public.project_selections;
create trigger selections_normalized_task_links_trigger
after insert or update of data on public.project_selections
for each row execute function public.sync_normalized_selection_task_links_trigger();

do $$
declare selection_row record;
begin
  for selection_row in select project_id, id, data from public.project_selections loop
    perform public.sync_normalized_selection_task_links(selection_row.project_id, selection_row.id, selection_row.data);
  end loop;
end;
$$;

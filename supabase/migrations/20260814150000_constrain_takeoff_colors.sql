update public.project_takeoff_measurements
set color = case type
  when 'area' then '#177e89'
  when 'count' then '#7b4cc2'
  else '#e4572e'
end
where color !~ '^#[0-9A-Fa-f]{6}$';

update public.project_takeoff_markups
set color = '#e4572e'
where color !~ '^#[0-9A-Fa-f]{6}$';

alter table public.project_takeoff_measurements
  drop constraint if exists project_takeoff_measurements_color_format_check;
alter table public.project_takeoff_measurements
  add constraint project_takeoff_measurements_color_format_check
  check (color ~ '^#[0-9A-Fa-f]{6}$');

alter table public.project_takeoff_markups
  drop constraint if exists project_takeoff_markups_color_format_check;
alter table public.project_takeoff_markups
  add constraint project_takeoff_markups_color_format_check
  check (color ~ '^#[0-9A-Fa-f]{6}$');

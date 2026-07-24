-- The original five tracker tables predate migration tracking in this project.
-- Recreate that baseline idempotently so a fresh local Supabase stack and CI can
-- replay every later migration without relying on production-only schema state.
create table if not exists public.projects (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.subs (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on table
  public.projects,
  public.tasks,
  public.subs,
  public.employees,
  public.settings
to anon, authenticated;

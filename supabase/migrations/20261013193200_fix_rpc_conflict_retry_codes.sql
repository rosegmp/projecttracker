-- PostgREST retries custom 40001 exceptions as serialization failures.
-- A stale selection save could therefore keep one API request alive forever.
-- Replace only this confirmed affected RPC's conflict code with HTTP 409.
do $$
declare
  definition text;
begin
  select pg_get_functiondef(
    'public.save_normalized_project_sections(text,jsonb,jsonb)'::regprocedure
  ) into definition;

  if position('NORMALIZED_VERSION_CONFLICT' in definition) = 0 then
    raise exception 'Expected normalized version checks were not found.';
  end if;

  execute replace(definition, '''40001''', '''PT409''');
end;
$$;

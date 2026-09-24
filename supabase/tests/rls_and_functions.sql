-- Behavioural checks: RLS isolation, optimistic timeline commits, vector search.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.projects (id, name) values ('10000000-0000-0000-0000-000000000001', 'A project');
insert into public.media_assets (id, project_id, kind, storage_path)
  values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'source', '0000/a/src.mp4');
insert into public.clips (id, project_id, source_asset_id, source_start_ms, source_end_ms)
  values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 0, 1000);
insert into public.timeline_versions (clip_id, version, timeline, author)
  values ('30000000-0000-0000-0000-000000000001', 0, '{"version":0}', 'system');

insert into public.transcripts (asset_id, provider, language, data)
  values ('20000000-0000-0000-0000-000000000001', 'fixture', 'es', '{"words":[{"text":"hola"},{"text":"mundo"}]}');
do $$ begin
  if not exists (select 1 from public.transcripts where text_search @@ to_tsquery('simple', 'mundo')) then
    raise exception 'transcript full-text search not populated';
  end if;
end $$;

-- commit v1 ok
select public.commit_timeline_version('30000000-0000-0000-0000-000000000001', 0, '{"version":0,"x":1}', '[]', '[]', 'user') as v1;
do $$ begin
  perform public.commit_timeline_version('30000000-0000-0000-0000-000000000001', 0, '{}', '[]', '[]', 'user');
  raise exception 'expected a version conflict';
exception when serialization_failure then raise notice 'conflict detected as expected';
end $$;
do $$ begin
  if (select (timeline->>'version')::int from public.timeline_versions where version = 1) <> 1 then
    raise exception 'version not stamped into timeline json';
  end if;
end $$;

-- user B sees nothing of A
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  if (select count(*) from public.projects) <> 0 then raise exception 'RLS leak: projects'; end if;
  if (select count(*) from public.timeline_versions) <> 0 then raise exception 'RLS leak: timelines'; end if;
end $$;
do $$ begin
  insert into public.projects (name, user_id) values ('evil', '00000000-0000-0000-0000-00000000000a');
  raise exception 'expected RLS to block inserting for another user';
exception when insufficient_privilege then raise notice 'cross-user insert blocked';
end $$;

-- feedback similarity search
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.edit_feedback (project_id, kind, area, scope, context, embedding, embedding_model)
select '10000000-0000-0000-0000-000000000001', 'correction', 'captions', 'always', '{"summary":"x"}',
       (select array_agg(case when i = n then 1 else 0 end)::real[]::extensions.vector from generate_series(1, 1536) i), 'test'
  from generate_series(1, 3) n;
do $$
declare top_sim real;
begin
  select similarity into top_sim from public.match_feedback(
    '00000000-0000-0000-0000-00000000000a',
    (select array_agg(case when i = 2 then 1 else 0 end)::real[]::extensions.vector from generate_series(1, 1536) i), 1);
  if abs(top_sim - 1) > 1e-6 then raise exception 'match_feedback returned similarity %', top_sim; end if;
end $$;
reset role;
select 'ALL DB TESTS PASSED' as result;

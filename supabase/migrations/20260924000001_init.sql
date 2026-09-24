-- Core schema for the AI video editor.
-- Every user-owned table carries user_id and is protected by RLS (owner-only).
-- Background workers use the service role, which bypasses RLS.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------- helpers
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- style profiles
create table public.style_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default 'Mi estilo',
  active_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.style_profiles (user_id);

create table public.style_profile_versions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.style_profiles (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version int not null check (version > 0),
  parent_version_id uuid references public.style_profile_versions (id),
  settings jsonb not null default '{}'::jsonb,       -- StyleSettings (defaults filled by the app)
  learned_rules jsonb not null default '[]'::jsonb,  -- LearnedRule[]
  provenance jsonb not null default '{}'::jsonb,
  change_summary text not null default '',
  created_by text not null check (created_by in ('user', 'agent', 'system')),
  created_at timestamptz not null default now(),
  unique (profile_id, version)
);

alter table public.style_profiles
  add constraint style_profiles_active_version_fk
  foreign key (active_version_id) references public.style_profile_versions (id) deferrable initially deferred;

-- ---------------------------------------------------------------- projects & media
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  mode text not null default 'clips' check (mode in ('clips', 'reels')),
  style_profile_id uuid references public.style_profiles (id) on delete set null,
  status text not null default 'created'
    check (status in ('created', 'uploading', 'processing', 'ready', 'failed')),
  settings jsonb not null default '{}'::jsonb,   -- e.g. { "clipCount": 5, "language": "es" }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.projects (user_id, created_at desc);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('source', 'proxy', 'audio', 'thumb', 'waveform', 'music', 'mask', 'render', 'export')),
  parent_asset_id uuid references public.media_assets (id) on delete cascade,
  storage_bucket text not null default 'media',
  storage_path text not null,
  status text not null default 'pending'
    check (status in ('pending', 'uploaded', 'ready', 'failed')),
  original_filename text,
  mime_type text,
  bytes bigint,
  sha256 text,
  duration_ms int,
  width int,
  height int,
  fps_num int,
  fps_den int,
  has_audio boolean,
  probe jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);
create index on public.media_assets (project_id, kind);

create table public.transcripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  asset_id uuid not null references public.media_assets (id) on delete cascade,
  provider text not null,
  provider_version text not null default '',
  language text not null,
  data jsonb not null,               -- Transcript (words with timestamps, speakers, sentences)
  word_count int not null default 0,
  text_search tsvector,
  created_at timestamptz not null default now(),
  unique (asset_id, provider)
);
create index on public.transcripts using gin (text_search);

create table public.face_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  asset_id uuid not null references public.media_assets (id) on delete cascade,
  start_ms int not null,
  end_ms int not null,
  model text not null,
  data jsonb not null,               -- FaceAnalysis
  created_at timestamptz not null default now(),
  unique (asset_id, start_ms, end_ms, model)
);

create table public.detection_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  asset_id uuid not null references public.media_assets (id) on delete cascade,
  job_id uuid,
  query text not null,
  kind text not null,
  model text not null,
  start_ms int not null,
  end_ms int not null,
  score real not null,
  keyframes jsonb not null,
  mask_asset_id uuid references public.media_assets (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.detection_tracks (asset_id, query);

-- ---------------------------------------------------------------- clips & timelines
create table public.clips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  source_asset_id uuid not null references public.media_assets (id) on delete cascade,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'final')),
  rank int,
  title text not null default '',
  justification text,
  scores jsonb,
  source_start_ms int not null,
  source_end_ms int not null,
  current_version int not null default 0,
  created_by text not null default 'user' check (created_by in ('llm', 'user', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_end_ms > source_start_ms)
);
create index on public.clips (project_id, rank);

create table public.timeline_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  clip_id uuid not null references public.clips (id) on delete cascade,
  version int not null check (version >= 0),
  parent_version int,
  timeline jsonb not null,           -- Timeline
  ops jsonb not null default '[]'::jsonb,        -- EditOp[] that produced it
  json_patch jsonb not null default '[]'::jsonb, -- RFC 6902 diff from parent
  author text not null check (author in ('user', 'agent', 'system')),
  message_id uuid,
  created_at timestamptz not null default now(),
  unique (clip_id, version)
);

create table public.renders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  clip_id uuid not null references public.clips (id) on delete cascade,
  timeline_version int not null,
  quality text not null check (quality in ('preview', 'final')),
  plan_hash text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  asset_id uuid references public.media_assets (id) on delete set null,
  job_id uuid,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clip_id, plan_hash)
);
create index on public.renders (clip_id, created_at desc);

-- ---------------------------------------------------------------- jobs
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  parent_job_id uuid references public.jobs (id) on delete cascade,
  type text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'waiting', 'succeeded', 'failed', 'canceled')),
  progress real not null default 0 check (progress between 0 and 1),
  step text,
  idempotency_key text not null unique,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  attempts int not null default 0,
  runner text,                        -- 'trigger' | 'inline'
  runner_run_id text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.jobs (project_id, created_at desc);
create index on public.jobs (status) where status in ('queued', 'running', 'waiting');

-- ---------------------------------------------------------------- chat & feedback
create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  clip_id uuid references public.clips (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index on public.chat_threads (clip_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null default '',
  tool_calls jsonb,
  timeline_version int,
  created_at timestamptz not null default now()
);
create index on public.chat_messages (thread_id, created_at);

create table public.edit_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  clip_id uuid references public.clips (id) on delete set null,
  thread_id uuid references public.chat_threads (id) on delete set null,
  message_id uuid references public.chat_messages (id) on delete set null,
  kind text not null check (kind in ('approve', 'reject', 'correction', 'instruction')),
  area text not null,
  user_text text,
  scope text not null check (scope in ('this_clip', 'project', 'always')),
  timeline_version_before int,
  timeline_version_after int,
  ops jsonb not null default '[]'::jsonb,
  json_patch jsonb not null default '[]'::jsonb,
  profile_version_before uuid references public.style_profile_versions (id) on delete set null,
  profile_version_after uuid references public.style_profile_versions (id) on delete set null,
  context jsonb not null,
  embedding extensions.vector(1536),
  embedding_model text,
  created_at timestamptz not null default now()
);
create index on public.edit_feedback (user_id, created_at desc);
create index edit_feedback_embedding_idx on public.edit_feedback
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------- MCP access tokens
create table public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  token_hash text not null unique,    -- sha256 of the token; the token itself is shown once
  scopes text[] not null default array['read', 'edit', 'render'],
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['style_profiles', 'projects', 'media_assets', 'clips', 'renders', 'jobs'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- RLS: owner-only everywhere
do $$
declare t text;
begin
  foreach t in array array[
    'style_profiles', 'style_profile_versions', 'projects', 'media_assets', 'transcripts', 'face_analyses',
    'detection_tracks', 'clips', 'timeline_versions', 'renders', 'jobs', 'chat_threads', 'chat_messages',
    'edit_feedback', 'mcp_tokens'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy owner_all on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- functions

-- Appends a timeline version with optimistic concurrency: fails if someone
-- else committed since `expected_version` was read.
create or replace function public.commit_timeline_version(
  p_clip_id uuid,
  p_expected_version int,
  p_timeline jsonb,
  p_ops jsonb,
  p_json_patch jsonb,
  p_author text,
  p_message_id uuid default null
) returns int
language plpgsql
security invoker
as $$
declare
  v_user uuid;
  v_new int := p_expected_version + 1;
begin
  update public.clips
     set current_version = v_new
   where id = p_clip_id and current_version = p_expected_version
  returning user_id into v_user;
  if not found then
    raise exception 'timeline version conflict for clip % (expected %)', p_clip_id, p_expected_version
      using errcode = '40001';
  end if;
  insert into public.timeline_versions (user_id, clip_id, version, parent_version, timeline, ops, json_patch, author, message_id)
  values (v_user, p_clip_id, v_new, p_expected_version, jsonb_set(p_timeline, '{version}', to_jsonb(v_new)), p_ops, p_json_patch, p_author, p_message_id);
  return v_new;
end $$;

-- Nearest past feedback for retrieval-augmented proposals.
create or replace function public.match_feedback(
  p_user_id uuid,
  p_embedding extensions.vector(1536),
  p_count int default 8,
  p_area text default null
) returns table (
  id uuid, kind text, area text, scope text, user_text text, context jsonb, ops jsonb, similarity real, created_at timestamptz
)
language sql stable
security invoker
set search_path = public, extensions
as $$
  select f.id, f.kind, f.area, f.scope, f.user_text, f.context, f.ops,
         (1 - (f.embedding <=> p_embedding))::real as similarity, f.created_at
    from public.edit_feedback f
   where f.user_id = p_user_id
     and f.embedding is not null
     and (p_area is null or f.area = p_area)
   order by f.embedding <=> p_embedding
   limit p_count
$$;

-- ---------------------------------------------------------------- realtime (UI job/clip status)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.jobs, public.clips, public.renders, public.media_assets;
  end if;
end $$;

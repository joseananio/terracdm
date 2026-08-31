-- TerraCDM persistence for the normal chat phase and durable overview runs.
--
-- These tables are server-owned. RLS is enabled without public policies so the
-- browser cannot read or write operational data directly. The Next.js server
-- uses SUPABASE_SECRET_KEY and will be replaced with owner-scoped RLS
-- when application auth is introduced.

create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  workspace_key text not null default 'default',
  name text not null,
  entity_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_key text not null default 'default',
  agent_role text not null default 'analyst',
  intent text not null,
  prompt text not null,
  summary text,
  provider text,
  model text,
  fallback boolean not null default false,
  steps jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.intelligence_snapshots (
  id uuid primary key default gen_random_uuid(),
  layer text not null,
  source_id text not null,
  status text not null,
  fetched_at timestamptz not null,
  content_hash text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.intelligence_events (
  event_id text primary key,
  layer text not null,
  source_id text,
  observed_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  workspace_key text not null default 'default',
  agent_role text not null default 'analyst',
  title text,
  entity_ids text[] not null default '{}',
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.agent_threads(id) on delete cascade,
  sequence integer not null,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null,
  provider text,
  model text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (thread_id, sequence)
);

create table if not exists public.agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.agent_runs(id) on delete cascade,
  thread_id uuid references public.agent_threads(id) on delete set null,
  tool_name text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create table if not exists public.overview_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_key text not null default 'default',
  dedupe_key text not null,
  trigger text not null check (trigger in ('ui', 'incoming-data', 'cron', 'manual')),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  context_hash text,
  workflow_run_id text,
  error text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (dedupe_key)
);

create table if not exists public.overview_artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_key text not null default 'default',
  context_hash text not null,
  trigger text not null check (trigger in ('ui', 'incoming-data', 'cron', 'manual')),
  overview text not null,
  highlights jsonb not null default '[]'::jsonb,
  helpers jsonb not null default '[]'::jsonb,
  provider text,
  model text,
  fallback boolean not null default false,
  source_fetched_at timestamptz,
  signal_count integer not null default 0,
  entity_count integer not null default 0,
  workflow_run_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.action_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_key text not null default 'default',
  action_id text not null,
  target text not null,
  status text not null check (status in ('running', 'completed', 'failed')),
  result jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists intelligence_snapshots_layer_fetched_idx on public.intelligence_snapshots (layer, fetched_at desc);
create unique index if not exists intelligence_snapshots_source_hash_idx on public.intelligence_snapshots (source_id, content_hash) where content_hash is not null;
create index if not exists intelligence_events_layer_observed_idx on public.intelligence_events (layer, observed_at desc);
create index if not exists agent_messages_thread_sequence_idx on public.agent_messages (thread_id, sequence);
create index if not exists agent_runs_workspace_created_idx on public.agent_runs (workspace_key, created_at desc);
create index if not exists overview_artifacts_workspace_created_idx on public.overview_artifacts (workspace_key, created_at desc);
create index if not exists overview_jobs_workspace_requested_idx on public.overview_jobs (workspace_key, requested_at desc);
create index if not exists action_runs_workspace_started_idx on public.action_runs (workspace_key, started_at desc);

alter table public.watchlists enable row level security;
alter table public.agent_runs enable row level security;
alter table public.intelligence_snapshots enable row level security;
alter table public.intelligence_events enable row level security;
alter table public.agent_threads enable row level security;
alter table public.agent_messages enable row level security;
alter table public.agent_tool_calls enable row level security;
alter table public.overview_jobs enable row level security;
alter table public.overview_artifacts enable row level security;
alter table public.action_runs enable row level security;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'intelligence_events') then
    alter publication supabase_realtime add table public.intelligence_events;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'overview_artifacts') then
    alter publication supabase_realtime add table public.overview_artifacts;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'overview_jobs') then
    alter publication supabase_realtime add table public.overview_jobs;
  end if;
end $$;

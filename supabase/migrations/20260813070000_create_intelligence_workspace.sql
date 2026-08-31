-- TerraCDM persistence boundary.
-- Apply this migration and the intelligence-events migration to the configured project.
create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  entity_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  intent text not null,
  prompt text not null,
  summary text,
  steps jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.watchlists enable row level security;
alter table public.agent_runs enable row level security;

create policy "watchlists are readable by authenticated users"
  on public.watchlists for select to authenticated using (true);
create policy "watchlists are writable by authenticated users"
  on public.watchlists for all to authenticated using (true) with check (true);
create policy "agent runs are readable by authenticated users"
  on public.agent_runs for select to authenticated using (true);
create policy "agent runs are writable by authenticated users"
  on public.agent_runs for all to authenticated using (true) with check (true);

alter publication supabase_realtime add table public.watchlists;
alter publication supabase_realtime add table public.agent_runs;

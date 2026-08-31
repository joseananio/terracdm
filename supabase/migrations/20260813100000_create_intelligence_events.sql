-- Durable provider snapshots and deduplicated incoming observations.
-- The server uses the service role for writes; browser reads remain protected by RLS.
create table if not exists public.intelligence_snapshots (
  id uuid primary key default gen_random_uuid(),
  layer text not null,
  source_id text not null,
  status text not null,
  fetched_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.intelligence_events (
  event_id text primary key,
  layer text not null,
  observed_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists intelligence_snapshots_layer_fetched_idx on public.intelligence_snapshots (layer, fetched_at desc);
create index if not exists intelligence_events_layer_observed_idx on public.intelligence_events (layer, observed_at desc);

alter table public.intelligence_snapshots enable row level security;
alter table public.intelligence_events enable row level security;

drop policy if exists "intelligence snapshots are readable by authenticated users" on public.intelligence_snapshots;
create policy "intelligence snapshots are readable by authenticated users"
  on public.intelligence_snapshots for select to authenticated using (true);

drop policy if exists "intelligence events are readable by authenticated users" on public.intelligence_events;
create policy "intelligence events are readable by authenticated users"
  on public.intelligence_events for select to authenticated using (true);

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'intelligence_events') then
    alter publication supabase_realtime add table public.intelligence_events;
  end if;
end $$;

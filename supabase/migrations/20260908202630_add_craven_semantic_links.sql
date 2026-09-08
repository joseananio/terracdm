create table public.semantic_observation_links (
  observation_id text not null references public.intelligence_observations(observation_id) on delete cascade,
  provider_namespace text not null,
  provider_id text not null,
  provider_revision text not null,
  canonical_id uuid,
  canonical_revision bigint,
  decision_id uuid,
  status text not null check (status in ('canonical','unresolved','redirected')),
  updated_at timestamptz not null default now(),
  primary key(provider_namespace, provider_id)
);
create index semantic_links_canonical_idx on public.semantic_observation_links(canonical_id) where canonical_id is not null;

create table public.semantic_sync_state (
  backend text primary key,
  cursor text,
  updated_at timestamptz not null default now()
);

alter table public.semantic_observation_links enable row level security;
alter table public.semantic_sync_state enable row level security;
revoke all on public.semantic_observation_links, public.semantic_sync_state from anon, authenticated;
grant select, insert, update on public.semantic_observation_links, public.semantic_sync_state to service_role;

comment on table public.semantic_observation_links is 'Optional canonical references; provider observations remain TerraCDM-owned and unchanged.';

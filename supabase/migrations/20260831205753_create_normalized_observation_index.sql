-- Queryable observation index for current entity and signal retrieval.
-- Full provider snapshots remain the immutable history/audit record.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

create table if not exists public.intelligence_observations (
  observation_id text primary key,
  kind text not null check (kind in ('entity', 'signal')),
  domain text not null,
  subdomain_id text not null,
  source_id text not null,
  source_name text not null,
  provider_id text not null,
  pack_id text,
  signal_type text,
  name text not null,
  description text not null default '',
  risk text not null check (risk in ('low', 'medium', 'high')),
  risk_score double precision not null,
  observed_at timestamptz not null,
  location_label text,
  location extensions.geography(point, 4326),
  search_text text not null default '',
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists intelligence_observations_order_idx
  on public.intelligence_observations (observed_at desc, risk_score desc, observation_id);
create index if not exists intelligence_observations_kind_order_idx
  on public.intelligence_observations (kind, observed_at desc, risk_score desc, observation_id);
create index if not exists intelligence_observations_domain_order_idx
  on public.intelligence_observations (domain, kind, observed_at desc, risk_score desc, observation_id);
create index if not exists intelligence_observations_source_order_idx
  on public.intelligence_observations (source_id, observed_at desc, risk_score desc, observation_id);
create index if not exists intelligence_observations_risk_order_idx
  on public.intelligence_observations (risk, observed_at desc, risk_score desc, observation_id);
create index if not exists intelligence_observations_search_idx
  on public.intelligence_observations using gin (to_tsvector('simple', search_text));
create index if not exists intelligence_observations_location_idx
  on public.intelligence_observations using gist (location);

alter table public.intelligence_observations enable row level security;
revoke all on table public.intelligence_observations from anon, authenticated;
grant select, insert, update on table public.intelligence_observations to service_role;

create or replace function public.query_intelligence_observations(
  p_ids text[] default null,
  p_kinds text[] default null,
  p_domains text[] default null,
  p_subdomain_ids text[] default null,
  p_risk text default null,
  p_source_ids text[] default null,
  p_query text default null,
  p_center_lat double precision default null,
  p_center_lng double precision default null,
  p_radius_km double precision default null,
  p_west double precision default null,
  p_south double precision default null,
  p_east double precision default null,
  p_north double precision default null,
  p_cursor_observed_at timestamptz default null,
  p_cursor_risk_score double precision default null,
  p_cursor_id text default null,
  p_limit integer default 500
)
returns table (payload jsonb, has_more boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  with page as materialized (
    select observation.payload, observation.observed_at, observation.risk_score, observation.observation_id
    from public.intelligence_observations as observation
    where
      (p_ids is null or observation.observation_id = any(p_ids))
      and (p_kinds is null or observation.kind = any(p_kinds))
      and (p_domains is null or observation.domain = any(p_domains))
      and (p_subdomain_ids is null or observation.subdomain_id = any(p_subdomain_ids))
      and (p_risk is null or observation.risk = p_risk)
      and (p_source_ids is null or observation.source_id = any(p_source_ids))
      and (
        nullif(btrim(p_query), '') is null
        or to_tsvector('simple', observation.search_text) @@ websearch_to_tsquery('simple', p_query)
      )
      and (
        p_center_lat is null or p_center_lng is null or p_radius_km is null
        or extensions.st_dwithin(
          observation.location,
          extensions.st_point(p_center_lng, p_center_lat)::extensions.geography,
          greatest(p_radius_km, 0) * 1000
        )
      )
      and (
        p_west is null or p_south is null or p_east is null or p_north is null
        or (
          p_west <= p_east
          and observation.location operator(extensions.&&) extensions.st_setsrid(
            extensions.st_makebox2d(extensions.st_point(p_west, p_south), extensions.st_point(p_east, p_north)),
            4326
          )
        )
        or (
          p_west > p_east
          and (
            observation.location operator(extensions.&&) extensions.st_setsrid(
              extensions.st_makebox2d(extensions.st_point(p_west, p_south), extensions.st_point(180, p_north)),
              4326
            )
            or observation.location operator(extensions.&&) extensions.st_setsrid(
              extensions.st_makebox2d(extensions.st_point(-180, p_south), extensions.st_point(p_east, p_north)),
              4326
            )
          )
        )
      )
      and (
        p_cursor_observed_at is null or p_cursor_risk_score is null or p_cursor_id is null
        or observation.observed_at < p_cursor_observed_at
        or (observation.observed_at = p_cursor_observed_at and observation.risk_score < p_cursor_risk_score)
        or (observation.observed_at = p_cursor_observed_at and observation.risk_score = p_cursor_risk_score and observation.observation_id > p_cursor_id)
      )
    order by observation.observed_at desc, observation.risk_score desc, observation.observation_id
    limit least(greatest(coalesce(p_limit, 500), 1), 2000) + 1
  ), page_status as (
    select count(*) > least(greatest(coalesce(p_limit, 500), 1), 2000) as has_more
    from page
  )
  select page.payload, page_status.has_more
  from page cross join page_status
  order by page.observed_at desc, page.risk_score desc, page.observation_id
  limit least(greatest(coalesce(p_limit, 500), 1), 2000)
$$;

revoke all on function public.query_intelligence_observations(text[], text[], text[], text[], text, text[], text, double precision, double precision, double precision, double precision, double precision, double precision, double precision, timestamptz, double precision, text, integer) from public, anon, authenticated;
grant execute on function public.query_intelligence_observations(text[], text[], text[], text[], text, text[], text, double precision, double precision, double precision, double precision, double precision, double precision, double precision, timestamptz, double precision, text, integer) to service_role;

-- Seed the new index from the same bounded history the old repository scanned.
with recent_snapshots as (
  select payload
  from public.intelligence_snapshots
  order by fetched_at desc
  limit 200
), latest as (
  select distinct on (observation->>'id') observation
  from recent_snapshots
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(payload->'observations') = 'array' then payload->'observations' else '[]'::jsonb end
  ) as observation
  where observation->>'kind' in ('entity', 'signal')
    and coalesce(observation->>'id', '') <> ''
    and coalesce(observation->>'observedAt', '') <> ''
  order by observation->>'id', observation->>'observedAt' desc
)
insert into public.intelligence_observations (
  observation_id, kind, domain, subdomain_id, source_id, source_name, provider_id,
  pack_id, signal_type, name, description, risk, risk_score, observed_at,
  location_label, location, search_text, payload
)
select
  observation->>'id',
  observation->>'kind',
  lower(observation->>'domain'),
  observation->>'subdomainId',
  lower(observation#>>'{source,id}'),
  observation#>>'{source,name}',
  observation->>'providerId',
  nullif(observation->>'packId', ''),
  nullif(observation->>'signalType', ''),
  observation->>'name',
  coalesce(observation->>'description', ''),
  case when observation->>'risk' in ('low', 'medium', 'high') then observation->>'risk' else 'low' end,
  case when coalesce(observation->>'riskScore', '') ~ '^-?[0-9]+(?:\.[0-9]+)?$' then (observation->>'riskScore')::double precision else 20 end,
  (observation->>'observedAt')::timestamptz,
  nullif(observation#>>'{location,label}', ''),
  case
    when coalesce(observation#>>'{location,coordinates,lng}', '') ~ '^-?[0-9]+(?:\.[0-9]+)?$'
      and coalesce(observation#>>'{location,coordinates,lat}', '') ~ '^-?[0-9]+(?:\.[0-9]+)?$'
    then extensions.st_point(
      (observation#>>'{location,coordinates,lng}')::double precision,
      (observation#>>'{location,coordinates,lat}')::double precision
    )::extensions.geography
    else null
  end,
  concat_ws(' ',
    observation->>'name', observation->>'description', observation#>>'{location,label}',
    observation->>'domain', observation->>'subdomainId', observation#>>'{source,id}',
    observation#>>'{source,name}', observation->>'providerId', observation->'properties'
  ),
  observation
from latest
where coalesce(observation->>'domain', '') <> ''
  and coalesce(observation->>'subdomainId', '') <> ''
  and coalesce(observation#>>'{source,id}', '') <> ''
  and coalesce(observation#>>'{source,name}', '') <> ''
  and coalesce(observation->>'providerId', '') <> ''
  and coalesce(observation->>'name', '') <> ''
on conflict (observation_id) do update set
  kind = excluded.kind,
  domain = excluded.domain,
  subdomain_id = excluded.subdomain_id,
  source_id = excluded.source_id,
  source_name = excluded.source_name,
  provider_id = excluded.provider_id,
  pack_id = excluded.pack_id,
  signal_type = excluded.signal_type,
  name = excluded.name,
  description = excluded.description,
  risk = excluded.risk,
  risk_score = excluded.risk_score,
  observed_at = excluded.observed_at,
  location_label = excluded.location_label,
  location = excluded.location,
  search_text = excluded.search_text,
  payload = excluded.payload,
  updated_at = now();

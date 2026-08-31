-- Store operator-selectable follow-up questions with each generated overview.
alter table public.overview_artifacts
  add column if not exists suggested_queries jsonb not null default '[]'::jsonb;

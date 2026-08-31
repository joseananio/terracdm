alter table public.overview_artifacts
  add column if not exists scope jsonb not null default '{"range":"24h","domains":[],"watchlistOnly":false}'::jsonb,
  add column if not exists developments jsonb not null default '[]'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

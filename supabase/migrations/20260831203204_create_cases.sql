create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  workspace_key text not null default 'default',
  title text not null,
  summary text not null default '',
  assessment text not null default '',
  status text not null default 'active' check (status in ('active', 'watching', 'closed')),
  risk text not null default 'medium' check (risk in ('low', 'medium', 'high')),
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  items jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cases_workspace_updated_idx on public.cases (workspace_key, updated_at desc);
alter table public.cases enable row level security;

-- System-wide map display settings for the current no-auth spike.
create table if not exists public.map_settings (
  scope text primary key,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint map_settings_scope_nonempty check (length(trim(scope)) > 0),
  constraint map_settings_settings_object check (jsonb_typeof(settings) = 'object')
);

alter table public.map_settings enable row level security;

revoke all on table public.map_settings from anon, authenticated;
grant all on table public.map_settings to service_role;

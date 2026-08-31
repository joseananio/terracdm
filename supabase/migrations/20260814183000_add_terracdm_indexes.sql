-- Cover the foreign keys used by agent tool-call history and make the
-- snapshot dedupe index directly usable by PostgREST upserts.
drop index if exists public.intelligence_snapshots_source_hash_idx;
create unique index if not exists intelligence_snapshots_source_hash_idx on public.intelligence_snapshots (source_id, content_hash);
create index if not exists agent_tool_calls_run_idx on public.agent_tool_calls (run_id);
create index if not exists agent_tool_calls_thread_idx on public.agent_tool_calls (thread_id);

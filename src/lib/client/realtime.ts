import { supabase } from "@/src/lib/persistence";

export function subscribeToIntelligence(onRefresh: () => void) {
  const client = supabase;
  if (!client) return () => undefined;
  const channel = client.channel("terracdm-intelligence", { config: { broadcast: { self: false } } })
    .on("broadcast", { event: "source-update" }, onRefresh)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "intelligence_events" }, onRefresh)
    .subscribe();
  return () => { void client.removeChannel(channel); };
}

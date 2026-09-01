import { supabase } from "@/src/lib/persistence";

export function subscribeToOverview(onRefresh: () => void) {
  const client = supabase;
  if (!client) return () => undefined;
  const channel = client.channel("terracdm-overview", { config: { broadcast: { self: false } } })
    .on("broadcast", { event: "overview-update" }, onRefresh)
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onRefresh();
    });
  return () => { void client.removeChannel(channel); };
}

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabase = url && key ? createClient(url, key) : null;

export async function saveWatchlist(name: string, entityIds: string[]) {
  if (!supabase) {
    localStorage.setItem("terracdm.watchlist", JSON.stringify({ name, entityIds }));
    return { persisted: false, mode: "local" as const };
  }

  const { error } = await supabase.from("watchlists").upsert({ name, entity_ids: entityIds });
  return { persisted: !error, mode: "supabase" as const };
}

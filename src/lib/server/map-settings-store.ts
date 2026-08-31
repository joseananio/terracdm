import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { defaultMapSettings, normalizeMapSettings, type MapSettings } from "@/src/lib/map-settings";

const settingsScope = "default";

function supabaseServer(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

export async function getMapSettings(): Promise<MapSettings> {
  const client = supabaseServer();
  if (!client) return defaultMapSettings;

  const { data, error } = await client.from("map_settings").select("settings").eq("scope", settingsScope).maybeSingle();
  if (error) throw new Error(`map settings read failed: ${error.message}`);
  return normalizeMapSettings(data?.settings);
}

export async function saveMapSettings(input: unknown): Promise<MapSettings> {
  const settings = normalizeMapSettings(input);
  const client = supabaseServer();
  if (!client) throw new Error("Supabase is not configured for map settings");

  const { data, error } = await client
    .from("map_settings")
    .upsert({ scope: settingsScope, settings, updated_at: new Date().toISOString() }, { onConflict: "scope" })
    .select("settings")
    .single();
  if (error) throw new Error(`map settings write failed: ${error.message}`);
  return normalizeMapSettings(data?.settings);
}

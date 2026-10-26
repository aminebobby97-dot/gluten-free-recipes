import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/env";

/**
 * Cookie-less client using the public (anon/publishable) key. Safe inside
 * `"use cache"` functions because it never reads the request. Row Level
 * Security limits it to categories and published recipes.
 *
 * Returns null when Supabase is not configured so pages can still build.
 */
export function createPublicClient(): SupabaseClient | null {
  const env = getSupabasePublicEnv();
  if (!env) return null;
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

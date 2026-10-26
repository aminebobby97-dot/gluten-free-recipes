import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/env";

/**
 * Service-role client. Bypasses Row Level Security, so it must only ever be
 * used in trusted server code (the future automation worker). Never import
 * this from a Client Component; `server-only` makes that a build error.
 */
export function createServiceClient(): SupabaseClient {
  const env = getSupabasePublicEnv();
  const serviceKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!env || !serviceKey) {
    throw new Error("Service client unavailable: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).");
  }
  return createClient(env.url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicEnv } from "@/lib/env";

/**
 * Per-request client bound to the signed-in user's session cookies. Used by
 * the admin dashboard; every query runs under the user's RLS policies.
 */
export async function createSessionClient() {
  const env = getSupabasePublicEnv();
  if (!env) {
    throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }
  const cookieStore = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

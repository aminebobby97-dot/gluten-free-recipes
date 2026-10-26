import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import { isSupabaseConfigured } from "@/lib/env";
import { createSessionClient } from "@/lib/supabase/server";

export type AdminSession =
  | { state: "unconfigured" }
  | { state: "signed_out" }
  | { state: "forbidden"; email: string | null }
  | { state: "admin"; supabase: SupabaseClient; user: { id: string; email: string | null } };

/**
 * Resolves the current admin once per request. The JWT is verified with
 * getClaims(), and admin membership is checked in the database (admin_users),
 * the same source Row Level Security uses.
 */
export const getAdminSession = cache(async (): Promise<AdminSession> => {
  if (!isSupabaseConfigured()) return { state: "unconfigured" };
  const supabase = await createSessionClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return { state: "signed_out" };
  const email = typeof claims.email === "string" ? claims.email : null;

  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error || isAdmin !== true) return { state: "forbidden", email };
  return { state: "admin", supabase, user: { id: claims.sub, email } };
});

/** For admin pages and Server Actions: returns the admin session or redirects to login. */
export async function requireAdmin(): Promise<Extract<AdminSession, { state: "admin" }>> {
  const session = await getAdminSession();
  if (session.state === "admin") return session;
  redirect(session.state === "forbidden" ? "/admin/login?error=forbidden" : "/admin/login");
}

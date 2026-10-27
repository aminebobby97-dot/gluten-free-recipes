// Central access to environment variables. Public values are safe for the
// browser; everything else must only be read on the server.

/** The site's primary domain. Used in production when NEXT_PUBLIC_SITE_URL is not set. */
export const PRIMARY_SITE_URL = "https://www.glutenfreerecipehub.com";

/**
 * The canonical site URL, without a trailing slash. NEXT_PUBLIC_SITE_URL wins;
 * otherwise Vercel production builds use the primary domain and everything else
 * (local development, previews) uses localhost, so canonicals never point at a
 * preview or Vercel-generated address by accident.
 */
export function resolveSiteUrl(env: Record<string, string | undefined> = process.env): string {
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim();
  const isProduction = (env.VERCEL_ENV || env.NEXT_PUBLIC_VERCEL_ENV) === "production";
  const url = configured || (isProduction ? PRIMARY_SITE_URL : "http://localhost:3000");
  return url.replace(/\/+$/, "");
}

export const siteConfig = {
  name: process.env.NEXT_PUBLIC_SITE_NAME?.trim() || "Crumb & Clover",
  tagline: "Gluten-free recipes made simple",
  url: resolveSiteUrl(),
  locale: "en_US",
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || "",
  pinterestHandle: process.env.NEXT_PUBLIC_PINTEREST_HANDLE?.trim() || "",
} as const;

export function absoluteUrl(path = "/"): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${siteConfig.url}${path.startsWith("/") ? path : `/${path}`}`;
}

export function getSupabasePublicEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return getSupabasePublicEnv() !== null;
}

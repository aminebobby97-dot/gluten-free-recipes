// Central access to environment variables. Public values are safe for the
// browser; everything else must only be read on the server.

export const siteConfig = {
  name: process.env.NEXT_PUBLIC_SITE_NAME?.trim() || "Crumb & Clover",
  tagline: "Gluten-free recipes made simple",
  url: (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, ""),
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

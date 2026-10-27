// The worker's links to Supabase Storage and to the live site.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImageStore, Photo, SiteRefresher } from "../types";

export const IMAGE_BUCKET = "recipe-images";

/** Uploads photos to the public recipe-images bucket, cached for a year (paths are never reused). */
export function createSupabaseImageStore(db: SupabaseClient, bucket = IMAGE_BUCKET): ImageStore {
  return {
    async upload(path: string, photo: Photo) {
      const { error } = await db.storage.from(bucket).upload(path, photo.data, { contentType: photo.mimeType, cacheControl: "31536000", upsert: false });
      if (error) throw new Error(`Upload ${path}: ${error.message}`);
      return db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    },
    async remove(paths: string[]) {
      const { error } = await db.storage.from(bucket).remove(paths);
      if (error) throw new Error(`Remove images: ${error.message}`);
    },
  };
}

/** Asks the site to expire its cached pages for a recipe, through the internal revalidate route. */
export function createSiteRefresher(siteUrl: string, secret: string, fetchImpl: typeof fetch = fetch): SiteRefresher {
  const url = new URL("/api/internal/revalidate", siteUrl).toString();
  return {
    async revalidate(slug: string) {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ slug }),
        signal: AbortSignal.timeout(15_000),
        // A redirect (for example from an old domain) would drop the secret and
        // fail with a confusing 401, so report it instead of following it.
        redirect: "manual",
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        throw new Error(`Site refresh was redirected (HTTP ${response.status}${location ? ` to ${location}` : ""}). Set SITE_URL to the site's primary domain.`);
      }
      if (!response.ok) throw new Error(`Site refresh failed with HTTP ${response.status}.`);
    },
  };
}

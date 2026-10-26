import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  // Keep preview deployments out of search engines.
  const isProduction = process.env.VERCEL_ENV ? process.env.VERCEL_ENV === "production" : true;
  if (!isProduction) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/search"] }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}

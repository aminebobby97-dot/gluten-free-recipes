"use client";

import { useEffect } from "react";

/**
 * Records one real page view per recipe per browser session. Counts power the
 * "Most viewed recipes" section; no numbers are ever invented.
 */
export function ViewTracker({ slug }: { slug: string }) {
  useEffect(() => {
    const key = `viewed:${slug}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Storage unavailable (private mode); still count the view once per mount.
    }
    const body = JSON.stringify({ slug });
    if (!navigator.sendBeacon?.("/api/views", new Blob([body], { type: "application/json" }))) {
      fetch("/api/views", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
    }
  }, [slug]);
  return null;
}

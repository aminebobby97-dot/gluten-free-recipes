import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PRIMARY_SITE_URL, resolveSiteUrl } from "@/lib/env";

describe("site URL", () => {
  it("uses NEXT_PUBLIC_SITE_URL when it is set, without a trailing slash", () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: " https://www.glutenfreerecipehub.com/ ", VERCEL_ENV: "production" })).toBe("https://www.glutenfreerecipehub.com");
  });

  it("falls back to the primary domain in Vercel production", () => {
    expect(PRIMARY_SITE_URL).toBe("https://www.glutenfreerecipehub.com");
    expect(resolveSiteUrl({ VERCEL_ENV: "production" })).toBe(PRIMARY_SITE_URL);
    expect(resolveSiteUrl({ NEXT_PUBLIC_VERCEL_ENV: "production" })).toBe(PRIMARY_SITE_URL);
  });

  it("falls back to localhost for previews and local development", () => {
    expect(resolveSiteUrl({ VERCEL_ENV: "preview" })).toBe("http://localhost:3000");
    expect(resolveSiteUrl({})).toBe("http://localhost:3000");
  });

  it("has no hardcoded *.vercel.app addresses in the app or the worker", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
      });
    const offenders = ["src", "scripts", ".github"].flatMap(files).filter((f) => /vercel\.app/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

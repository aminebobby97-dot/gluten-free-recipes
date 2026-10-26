import { describe, expect, it } from "vitest";
import { formatMinutes, isValidSlug, slugify, toIsoDuration, totalMinutes, truncate } from "@/lib/recipes/format";
import { pageHref, pageWindow, parsePageParam } from "@/lib/pagination";

describe("time helpers", () => {
  it("formats minutes for people", () => {
    expect(formatMinutes(30)).toBe("30 mins");
    expect(formatMinutes(1)).toBe("1 min");
    expect(formatMinutes(60)).toBe("1 hr");
    expect(formatMinutes(135)).toBe("2 hrs 15 mins");
    expect(formatMinutes(null)).toBe("");
  });

  it("formats ISO 8601 durations", () => {
    expect(toIsoDuration(0)).toBe("PT0M");
    expect(toIsoDuration(45)).toBe("PT45M");
    expect(toIsoDuration(120)).toBe("PT2H");
    expect(toIsoDuration(null)).toBeUndefined();
  });

  it("totals prep and cook time", () => {
    expect(totalMinutes(10, 20)).toBe(30);
    expect(totalMinutes(null, null)).toBeNull();
  });
});

describe("slugs", () => {
  it("creates SEO-friendly slugs", () => {
    expect(slugify("Easy Gluten-Free Banana Bread!")).toBe("easy-gluten-free-banana-bread");
    expect(slugify("Mac & Cheese  (Crème Fraîche)")).toBe("mac-and-cheese-creme-fraiche");
  });

  it("rejects invalid or reserved slugs", () => {
    expect(isValidSlug("gluten-free-pancakes")).toBe(true);
    expect(isValidSlug("Gluten Free")).toBe(false);
    expect(isValidSlug("double--hyphen")).toBe(false);
    expect(isValidSlug("page")).toBe(false);
  });

  it("truncates on word boundaries", () => {
    expect(truncate("one two three four", 12)).toBe("one two…");
    expect(truncate("short", 12)).toBe("short");
  });
});

describe("pagination", () => {
  it("builds clean page URLs", () => {
    expect(pageHref("/recipes", 1)).toBe("/recipes");
    expect(pageHref("/recipes", 3)).toBe("/recipes/page/3");
  });

  it("only accepts page numbers of 2 or more", () => {
    expect(parsePageParam("2")).toBe(2);
    expect(parsePageParam("1")).toBeNull();
    expect(parsePageParam("01")).toBeNull();
    expect(parsePageParam("abc")).toBeNull();
  });

  it("collapses long page lists", () => {
    expect(pageWindow(5, 12)).toEqual([1, "gap", 4, 5, 6, "gap", 12]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });
});

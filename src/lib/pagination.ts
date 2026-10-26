// Path-based pagination helpers: page 1 lives at the base path, later pages at
// `${base}/page/N`. Clean URLs keep every page crawlable and cacheable.

export function pageHref(basePath: string, page: number): string {
  return page <= 1 ? basePath : `${basePath}/page/${page}`;
}

/** Parses a page segment. Returns null for anything that is not an integer >= 2. */
export function parsePageParam(value: string): number | null {
  if (!/^[1-9]\d{0,4}$/.test(value)) return null;
  const page = Number(value);
  return page >= 2 ? page : null;
}

/** Compact list of page numbers around the current page, e.g. [1, "gap", 4, 5, 6, "gap", 12]. */
export function pageWindow(page: number, totalPages: number): Array<number | "gap"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const result: Array<number | "gap"> = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) result.push("gap");
    result.push(p);
  });
  return result;
}

import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { pageHref, pageWindow } from "@/lib/pagination";

export function Pagination({ basePath, page, totalPages }: { basePath: string; page: number; totalPages: number }) {
  if (totalPages <= 1) return null;
  const pages = pageWindow(page, totalPages);
  const linkClass = "grid h-10 min-w-10 place-items-center rounded-full px-3 text-sm font-medium transition-colors";
  return (
    <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-1.5">
      {page > 1 ? (
        <Link href={pageHref(basePath, page - 1)} rel="prev" className={`${linkClass} text-ink hover:bg-sage-wash`}>
          <ChevronLeftIcon size={18} />
          <span className="sr-only">Previous page</span>
        </Link>
      ) : (
        <span className={`${linkClass} text-ink-faint/50`} aria-hidden="true">
          <ChevronLeftIcon size={18} />
        </span>
      )}
      {pages.map((p, i) =>
        p === "gap" ? (
          <span key={`gap-${i}`} className="px-1 text-ink-faint">
            …
          </span>
        ) : (
          <Link
            key={p}
            href={pageHref(basePath, p)}
            aria-current={p === page ? "page" : undefined}
            className={`${linkClass} ${p === page ? "bg-sage text-white" : "text-ink hover:bg-sage-wash"}`}
          >
            {p}
          </Link>
        ),
      )}
      {page < totalPages ? (
        <Link href={pageHref(basePath, page + 1)} rel="next" className={`${linkClass} text-ink hover:bg-sage-wash`}>
          <ChevronRightIcon size={18} />
          <span className="sr-only">Next page</span>
        </Link>
      ) : (
        <span className={`${linkClass} text-ink-faint/50`} aria-hidden="true">
          <ChevronRightIcon size={18} />
        </span>
      )}
    </nav>
  );
}

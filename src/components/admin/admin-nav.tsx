"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/recipes", label: "Recipes" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/keywords", label: "Keywords" },
  { href: "/admin/jobs", label: "Publishing jobs" },
  { href: "/admin/pinterest", label: "Pinterest" },
  { href: "/admin/errors", label: "Errors" },
];

export function AdminNav() {
  return <NavLinks pathname={usePathname()} />;
}

/** Rendered before the current path is known (prerender fallback). */
export function AdminNavFallback() {
  return <NavLinks pathname="" />;
}

function NavLinks({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Admin" className="flex gap-1 overflow-x-auto lg:flex-col">
      {items.map((item) => {
        const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? "bg-sage text-white" : "text-ink-soft hover:bg-cream-deep hover:text-ink"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { CloseIcon, MenuIcon, SearchIcon } from "@/components/icons";

export function MobileNav({ links }: { links: ReadonlyArray<{ label: string; href: string }> }) {
  const pathname = usePathname();
  const panelId = useId();
  // The menu is open only for the page it was opened on, so it closes after navigating.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const toggle = () => setOpenOn(open ? null : pathname);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenOn(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        className="grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-sage-wash"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        {open ? <CloseIcon size={22} /> : <MenuIcon size={22} />}
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
      </button>
      {open && (
        <div id={panelId} className="absolute inset-x-0 top-full border-b border-line bg-cream shadow-lift">
          <nav aria-label="Mobile" className="container-page flex flex-col py-3">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="border-b border-line py-3.5 font-serif text-xl text-ink last:border-0"
                aria-current={pathname === link.href ? "page" : undefined}
              >
                {link.label}
              </Link>
            ))}
            <Link href="/search" className="mt-2 flex items-center gap-2 py-3 text-sm font-semibold text-sage-dark">
              <SearchIcon size={18} /> Search recipes
            </Link>
          </nav>
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { SearchIcon } from "@/components/icons";
import { primaryNav } from "@/content/site";
import { Logo } from "./logo";
import { MobileNav } from "./mobile-nav";

export function SiteHeader() {
  return (
    <header className="print-hidden sticky top-0 z-40 border-b border-line/80 bg-cream/90 backdrop-blur supports-[backdrop-filter]:bg-cream/75">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <div className="container-page relative flex h-[4.5rem] items-center justify-between gap-6">
        <Logo />
        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {primaryNav.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full px-3.5 py-2 text-[0.9375rem] font-medium text-ink-soft transition-colors hover:bg-sage-wash hover:text-sage-dark"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <Link
            href="/search"
            className="grid h-10 w-10 place-items-center rounded-full text-ink transition-colors hover:bg-sage-wash hover:text-sage-dark"
          >
            <SearchIcon size={20} />
            <span className="sr-only">Search recipes</span>
          </Link>
          <MobileNav links={primaryNav} />
        </div>
      </div>
    </header>
  );
}

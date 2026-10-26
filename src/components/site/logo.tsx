import Link from "next/link";
import { siteConfig } from "@/lib/env";

export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true" focusable="false">
      <circle cx="20" cy="20" r="19" fill="#536B4F" />
      <path d="M13 27c0-8 4.5-13 14-14-.8 9-5.5 14-14 14Z" fill="#FAF8F3" />
      <path d="M13 27l8.5-8.5" stroke="#536B4F" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label={`${siteConfig.name} home`}>
      <LogoMark className="h-9 w-9 shrink-0 transition-transform duration-300 group-hover:-rotate-12" />
      <span className="flex flex-col leading-none">
        <span className="font-serif text-[1.35rem] font-semibold tracking-tight text-ink">{siteConfig.name}</span>
        <span className="mt-1 text-[0.625rem] font-semibold uppercase tracking-[0.2em] text-sage">Gluten-free kitchen</span>
      </span>
    </Link>
  );
}

import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@/lib/env";
import logoLeaf from "./logo-leaf.png";

// The green leaf brand logo. The PNG is already resized and compressed (about 4 KB,
// see scripts/branding/), so it's served as is: Next's re-encoding would only blur it.
export function LogoMark({ className = "", preload = false }: { className?: string; preload?: boolean }) {
  return (
    <Image
      src={logoLeaf}
      alt=""
      aria-hidden="true"
      unoptimized
      preload={preload}
      className={`object-contain ${className}`}
    />
  );
}

export function Logo() {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label={`${siteConfig.name} home`}>
      <LogoMark preload className="h-13 w-auto shrink-0 transition-transform duration-300 group-hover:-rotate-12" />
      <span className="flex flex-col leading-none">
        <span className="font-serif text-[1.35rem] font-semibold tracking-tight text-ink">{siteConfig.name}</span>
        <span className="mt-1 text-[0.625rem] font-semibold uppercase tracking-[0.2em] text-sage">Gluten-free kitchen</span>
      </span>
    </Link>
  );
}

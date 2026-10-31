import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@/lib/env";
import logoLeaf from "./logo-leaf.png";

// The clean green leaf brand logo (no lettering). The PNG is already resized and compressed (about 4 KB,
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
      <LogoMark preload className="h-10 w-auto shrink-0 transition-transform duration-300 group-hover:-rotate-12" />
      <span className="font-serif text-[1.35rem] font-semibold leading-none max-[359px]:text-[1.15rem] tracking-tight whitespace-nowrap text-ink">{siteConfig.name}</span>
    </Link>
  );
}

import { cacheLife } from "next/cache";
import Link from "next/link";
import { footerNav, primaryNav } from "@/content/site";
import { siteConfig } from "@/lib/env";
import { LogoMark } from "./logo";

const moreCategories = [
  { label: "Baking", href: "/categories/gluten-free-baking" },
  { label: "Snacks", href: "/categories/gluten-free-snacks" },
  { label: "Dairy-Free", href: "/categories/gluten-free-dairy-free" },
  { label: "High-Protein", href: "/categories/high-protein-gluten-free" },
];

export function SiteFooter() {
  return (
    <footer className="print-hidden mt-24 border-t border-line bg-cream-deep">
      <div className="container-page grid gap-12 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="max-w-sm">
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-8 w-8" />
            <span className="font-serif text-xl font-semibold">{siteConfig.name}</span>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-ink-soft">
            Easy, flavorful gluten-free recipes for everyday cooking. Our recipes avoid gluten-containing ingredients, but
            always check product labels and consult a medical professional about your own dietary needs.
          </p>
        </div>
        <FooterColumn title="Recipes" links={primaryNav} />
        <FooterColumn title="More categories" links={moreCategories} />
        <FooterColumn title="About" links={footerNav} />
      </div>
      <div className="border-t border-line">
        <div className="container-page flex flex-col gap-2 py-6 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between">
          <p>
            © <CopyrightYear /> {siteConfig.name}. All rights reserved.
          </p>
          <p>Not medical advice. Results may vary.</p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: ReadonlyArray<{ label: string; href: string }> }) {
  return (
    <div>
      <h2 className="font-sans text-xs font-semibold uppercase tracking-[0.14em] text-ink">{title}</h2>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-sm text-ink-soft transition-colors hover:text-sage-dark">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function CopyrightYear() {
  "use cache";
  cacheLife("days");
  return <>{new Date().getFullYear()}</>;
}

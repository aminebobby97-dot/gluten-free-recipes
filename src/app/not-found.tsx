import Link from "next/link";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="container-page flex flex-1 flex-col items-center justify-center py-24 text-center">
        <p className="eyebrow">Error 404</p>
        <h1 className="mt-3 text-4xl font-medium text-ink md:text-5xl">We couldn&apos;t find that page</h1>
        <p className="mt-4 max-w-md text-ink-soft">The recipe may have moved or is no longer available.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/recipes" className="btn btn-primary">
            Browse recipes
          </Link>
          <Link href="/search" className="btn btn-secondary">
            Search
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

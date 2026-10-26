import { Breadcrumbs } from "./breadcrumbs";

/** Simple long-form page used for About, policies and the disclaimer. */
export function InfoPage({ title, path, updated, children }: { title: string; path: string; updated?: string; children: React.ReactNode }) {
  return (
    <div className="container-page py-10 md:py-14">
      <div className="mx-auto max-w-2xl">
        <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: title, href: path }]} />
        <h1 className="mt-6 text-4xl font-medium leading-tight text-ink md:text-5xl">{title}</h1>
        {updated && <p className="mt-3 text-sm text-ink-faint">Last updated {updated}</p>}
        <div className="prose-recipe mt-8 space-y-5 [&_a]:font-medium [&_a]:text-sage-dark [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-10 [&_h2]:text-2xl [&_h2]:font-medium [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-2">
          {children}
        </div>
      </div>
    </div>
  );
}

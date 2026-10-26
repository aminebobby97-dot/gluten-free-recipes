import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { Breadcrumbs, type Crumb } from "@/components/site/breadcrumbs";
import { Pagination } from "@/components/site/pagination";
import { featuredCategories } from "@/content/site";
import type { Paginated } from "@/lib/data/public";
import type { RecipeCardData } from "@/lib/recipes/types";
import { buildBreadcrumbJsonLd, buildItemListJsonLd } from "@/lib/seo/structured-data";
import { EmptyRecipes, RecipeGrid } from "./recipe-card";

interface ListingProps {
  title: string;
  introduction?: string;
  breadcrumbs: Crumb[];
  basePath: string;
  result: Paginated<RecipeCardData>;
  activeCategorySlug?: string;
}

/** Shared layout for the all-recipes index and the category landing pages. */
export function RecipeListing({ title, introduction, breadcrumbs, basePath, result, activeCategorySlug }: ListingProps) {
  const { items, page, totalPages, total } = result;
  return (
    <>
      <JsonLd data={[buildBreadcrumbJsonLd(breadcrumbs), buildItemListJsonLd(items.map((r) => `/recipes/${r.slug}`))]} />
      <section className="border-b border-line">
        <div className="container-page py-10 md:py-14">
          <Breadcrumbs items={breadcrumbs} />
          <h1 className="mt-6 max-w-3xl text-4xl font-medium leading-tight text-ink md:text-6xl">
            {title}
            {page > 1 && <span className="ml-3 align-middle font-sans text-base font-normal text-ink-faint">Page {page}</span>}
          </h1>
          {introduction && page === 1 && (
            <div className="prose-recipe mt-6 max-w-3xl text-ink-soft">
              {introduction.split(/\n{2,}/).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          )}
          <CategoryChips active={activeCategorySlug} />
        </div>
      </section>
      <section className="container-page py-12">
        {total > 0 && (
          <p className="mb-6 text-sm text-ink-faint">
            {total} {total === 1 ? "recipe" : "recipes"}
          </p>
        )}
        {items.length > 0 ? (
          <RecipeGrid recipes={items} priorityCount={4} />
        ) : (
          <EmptyRecipes title="No recipes here yet">
            New gluten-free recipes are published regularly. In the meantime, <Link href="/recipes" className="font-semibold text-sage-dark underline-offset-4 hover:underline">browse all recipes</Link>.
          </EmptyRecipes>
        )}
        <Pagination basePath={basePath} page={page} totalPages={totalPages} />
      </section>
    </>
  );
}

function CategoryChips({ active }: { active?: string }) {
  const chip = "shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors";
  return (
    <nav aria-label="Categories" className="-mx-5 mt-8 overflow-x-auto px-5 pb-1 md:mx-0 md:px-0">
      <ul className="flex gap-2 md:flex-wrap">
        <li>
          <Link
            href="/recipes"
            aria-current={!active ? "page" : undefined}
            className={`${chip} ${!active ? "border-sage bg-sage text-white" : "border-line-strong bg-card text-ink-soft hover:border-sage hover:text-sage-dark"}`}
          >
            All
          </Link>
        </li>
        {featuredCategories.map((c) => (
          <li key={c.slug}>
            <Link
              href={`/categories/${c.slug}`}
              aria-current={active === c.slug ? "page" : undefined}
              className={`${chip} ${active === c.slug ? "border-sage bg-sage text-white" : "border-line-strong bg-card text-ink-soft hover:border-sage hover:text-sage-dark"}`}
            >
              {c.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

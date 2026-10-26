import type { Metadata } from "next";
import Form from "next/form";
import { Suspense } from "react";
import { SearchIcon } from "@/components/icons";
import { EmptyRecipes, RecipeGrid, RecipeGridSkeleton } from "@/components/recipe/recipe-card";
import { searchRecipes } from "@/lib/data/search";

export const metadata: Metadata = {
  title: "Search Gluten-Free Recipes",
  description: "Search all gluten-free recipes by name or ingredient.",
  alternates: { canonical: "/search" },
  // Search result pages should not be indexed.
  robots: { index: false, follow: true },
};

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <div className="container-page py-12 md:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Search</p>
        <h1 className="mt-3 text-4xl font-medium text-ink md:text-5xl">Find a gluten-free recipe</h1>
        <Suspense fallback={<SearchForm />}>
          <SearchFormWithQuery searchParams={searchParams} />
        </Suspense>
      </div>
      <div className="mt-12">
        <Suspense fallback={<RecipeGridSkeleton count={4} />}>
          <Results searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

function readQuery(params: Record<string, string | string[] | undefined>): string {
  const q = params.q;
  return (Array.isArray(q) ? q[0] : q)?.trim() ?? "";
}

async function SearchFormWithQuery({ searchParams }: Pick<PageProps<"/search">, "searchParams">) {
  return <SearchForm defaultValue={readQuery(await searchParams)} />;
}

function SearchForm({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <Form action="/search" className="relative mt-8" role="search">
      <label htmlFor="search-q" className="sr-only">
        Search recipes
      </label>
      <input
        id="search-q"
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder="Try “banana bread” or “chicken”"
        minLength={2}
        maxLength={100}
        className="h-14 w-full rounded-full border border-line-strong bg-card pl-6 pr-16 text-base shadow-card outline-none placeholder:text-ink-faint focus:border-sage focus:ring-4 focus:ring-sage/15"
      />
      <button type="submit" className="absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full bg-sage text-white hover:bg-sage-dark">
        <SearchIcon size={18} />
        <span className="sr-only">Search</span>
      </button>
    </Form>
  );
}

async function Results({ searchParams }: Pick<PageProps<"/search">, "searchParams">) {
  const q = readQuery(await searchParams);
  if (q.length < 2) {
    return <p className="text-center text-ink-soft">Enter at least two characters to search.</p>;
  }
  const results = await searchRecipes(q);
  if (results.length === 0) {
    return <EmptyRecipes title={`No recipes found for “${q}”`}>Try a different ingredient or a broader search term.</EmptyRecipes>;
  }
  return (
    <>
      <p className="mb-6 text-sm text-ink-faint">
        {results.length} {results.length === 1 ? "result" : "results"} for “{q}”
      </p>
      <RecipeGrid recipes={results} />
    </>
  );
}

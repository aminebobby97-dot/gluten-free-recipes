import Link from "next/link";
import { ClockIcon } from "@/components/icons";
import { formatMinutes, totalMinutes } from "@/lib/recipes/format";
import type { RecipeCardData } from "@/lib/recipes/types";
import { RecipeImage } from "./recipe-image";

export function RecipeCard({ recipe, priority = false }: { recipe: RecipeCardData; priority?: boolean }) {
  const href = `/recipes/${recipe.slug}`;
  const time = totalMinutes(recipe.prep_time, recipe.cook_time);
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-card transition-shadow duration-300 hover:shadow-lift">
      <div className="relative aspect-[4/3] overflow-hidden bg-cream-deep">
        <RecipeImage
          src={recipe.featured_image}
          alt={recipe.featured_image_alt}
          categorySlug={recipe.category?.slug}
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
          priority={priority}
          className="transition-transform duration-500 ease-out group-hover:scale-[1.03]"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        {recipe.category && (
          <p className="eyebrow relative z-10">
            <Link href={`/categories/${recipe.category.slug}`} className="hover:text-sage-dark">
              {recipe.category.short_name}
            </Link>
          </p>
        )}
        <h3 className="font-serif text-[1.3rem] font-medium leading-snug text-ink">
          <Link href={href} className="after:absolute after:inset-0 after:content-[''] group-hover:text-sage-dark">
            {recipe.title}
          </Link>
        </h3>
        {recipe.prep_time != null && (
          <p className="mt-auto flex items-center gap-1.5 pt-2 text-sm text-ink-soft">
            <ClockIcon size={16} className="text-sage" />
            <span>
              Prep {formatMinutes(recipe.prep_time)}
              {time != null && time !== recipe.prep_time && <span className="text-ink-faint"> · Total {formatMinutes(time)}</span>}
            </span>
          </p>
        )}
      </div>
    </article>
  );
}

export function RecipeGrid({ recipes, priorityCount = 0 }: { recipes: RecipeCardData[]; priorityCount?: number }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {recipes.map((recipe, i) => (
        <RecipeCard key={recipe.id} recipe={recipe} priority={i < priorityCount} />
      ))}
    </div>
  );
}

export function RecipeGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-card">
          <div className="aspect-[4/3] animate-pulse bg-cream-deep" />
          <div className="space-y-3 p-5">
            <div className="h-3 w-20 animate-pulse rounded bg-cream-deep" />
            <div className="h-5 w-4/5 animate-pulse rounded bg-cream-deep" />
            <div className="h-3 w-28 animate-pulse rounded bg-cream-deep" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyRecipes({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-card/60 px-6 py-14 text-center">
      <p className="font-serif text-2xl text-ink">{title}</p>
      {children && <div className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-soft">{children}</div>}
    </div>
  );
}

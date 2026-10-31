import Image from "next/image";
import Link from "next/link";
import { ArrowRightIcon, CategoryGlyph, CheckIcon } from "@/components/icons";
import heroPhoto from "@/content/images/hero-bowl.webp";
import { JsonLd } from "@/components/json-ld";
import { EmptyRecipes, RecipeGrid } from "@/components/recipe/recipe-card";
import { featuredCategories, heroImage } from "@/content/site";
import { getCategories, getLatestRecipes, getPopularRecipes } from "@/lib/data/public";
import { buildWebsiteJsonLd } from "@/lib/seo/structured-data";
import { pageMetadata } from "@/lib/seo/metadata";

const homeTitle = "Gluten-Free Recipes | Easy & Delicious Recipes";

export const metadata = {
  ...pageMetadata({
    title: homeTitle,
    description:
      "Easy, flavorful gluten-free recipes for everyday cooking. Discover gluten-free breakfasts, dinners, desserts, baking and more.",
    path: "/",
    image: heroImage.src,
    imageAlt: heroImage.alt,
  }),
  // The homepage title is complete on its own; skip the "| Site" template.
  title: { absolute: homeTitle },
};

export default function HomePage() {
  return (
    <>
      <JsonLd data={buildWebsiteJsonLd()} />
      <Hero />
      <CategoriesSection />
      <LatestSection />
      <PopularSection />
      <ApproachSection />
    </>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-line bg-cream">
      <div className="container-page grid items-center gap-6 pb-6 pt-12 md:pt-16 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-6 lg:py-10 xl:py-12">
        <div className="max-w-xl">
          <p className="eyebrow">Gluten-free, every day</p>
          <h1 className="mt-4 text-[2.6rem] font-medium leading-[1.05] text-ink sm:text-6xl lg:text-[4.25rem]">
            Delicious Gluten-Free Recipes <em className="font-normal text-sage">Made Simple</em>
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-soft">
            Easy, flavorful recipes for everyday cooking. Discover gluten-free breakfasts, dinners, desserts, and more.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/recipes" className="btn btn-primary px-6 py-3.5 text-base">
              Explore Recipes <ArrowRightIcon size={18} />
            </Link>
            <Link href="#categories" className="btn btn-ghost">
              Browse categories
            </Link>
          </div>
        </div>
        <HeroPhoto />
      </div>
    </section>
  );
}

/**
 * Large food photograph on the right of the hero, on a warm cream surface. Its
 * edges are feathered (see .hero-photo in globals.css) so it melts into the page.
 * Static import: Next.js reads its size and builds a blur placeholder, and
 * serves AVIF/WebP at the right width for each screen.
 */
function HeroPhoto() {
  return (
    <div className="relative -mx-5 sm:mx-auto sm:w-full sm:max-w-[40rem] lg:-mr-8 lg:ml-0 lg:max-w-none xl:-mr-12">
      <Image
        src={heroPhoto}
        alt="A gluten-free quinoa bowl with crispy tofu, roasted sweet potatoes, sliced avocado, cherry tomatoes, cucumber, red cabbage, sprouts and spinach in a ceramic bowl, in soft daylight"
        preload
        placeholder="blur"
        sizes="(min-width: 1280px) 680px, (min-width: 1024px) 56vw, (min-width: 640px) 640px, 100vw"
        className="hero-photo h-auto w-full"
      />
    </div>
  );
}

async function CategoriesSection() {
  const categories = await getCategories();
  const bySlug = new Map(categories.map((c) => [c.slug, c]));
  return (
    <section id="categories" className="container-page scroll-mt-24 py-16 md:py-20">
      <SectionHeading eyebrow="Browse" title="Recipe categories" href="/recipes" linkLabel="All recipes" />
      <ul className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-5">
        {featuredCategories.map(({ slug, label }) => {
          const category = bySlug.get(slug);
          return (
            <li key={slug}>
              <Link
                href={`/categories/${slug}`}
                className="group flex h-full flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-card p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-sage-light hover:shadow-card md:p-6"
              >
                <span className="grid h-14 w-14 place-items-center rounded-full bg-sage-wash text-sage transition-colors group-hover:bg-sage group-hover:text-cream">
                  <CategoryGlyph slug={slug} size={30} strokeWidth={1.6} />
                </span>
                <span>
                  <span className="block font-serif text-xl font-medium text-ink">{category?.short_name ?? label}</span>
                  {category?.description && (
                    <span className="mt-1.5 line-clamp-2 hidden text-sm leading-relaxed text-ink-soft sm:block">{category.description}</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

async function LatestSection() {
  const recipes = await getLatestRecipes(12);
  return (
    <section className="container-page py-8 md:py-10">
      <SectionHeading eyebrow="Fresh from the kitchen" title="Latest recipes" href="/recipes" linkLabel="View all" />
      <div className="mt-10">
        {recipes.length > 0 ? (
          <RecipeGrid recipes={recipes} priorityCount={0} />
        ) : (
          <EmptyRecipes title="New recipes are on the way">
            We are reviewing our first gluten-free recipes. Check back soon.
          </EmptyRecipes>
        )}
      </div>
    </section>
  );
}

async function PopularSection() {
  const recipes = await getPopularRecipes(4);
  // Only shown once real view data exists.
  if (recipes.length === 0) return null;
  return (
    <section className="container-page py-16 md:py-20">
      <SectionHeading eyebrow="Reader favorites" title="Most viewed recipes" />
      <div className="mt-10">
        <RecipeGrid recipes={recipes} />
      </div>
    </section>
  );
}

function ApproachSection() {
  const points = [
    {
      title: "Built on gluten-free ingredients",
      body: "Recipes avoid wheat, barley and rye, and use gluten-free flour blends, grains and pasta.",
    },
    {
      title: "Label checks flagged",
      body: "Oats, sauces, broths and other products that need a gluten-free label are called out in every recipe.",
    },
    {
      title: "Honest about testing",
      body: "We never claim a recipe was tested or tasted when it was not, and nutrition is always marked as an estimate.",
    },
  ];
  return (
    <section className="container-page pt-16 md:pt-24">
      <div className="grid gap-10 rounded-[2rem] bg-sage px-6 py-12 text-cream md:grid-cols-[1fr_1.6fr] md:px-12 md:py-14">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sage-wash/80">Our approach</p>
          <h2 className="mt-3 text-3xl font-medium leading-tight md:text-4xl">How we write gluten-free recipes</h2>
          <Link href="/editorial-policy" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-cream underline-offset-4 hover:underline">
            Read our editorial policy <ArrowRightIcon size={16} />
          </Link>
        </div>
        <ul className="grid gap-6 sm:grid-cols-3">
          {points.map((point) => (
            <li key={point.title}>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-cream/15">
                <CheckIcon size={18} />
              </span>
              <h3 className="mt-4 font-sans text-base font-semibold">{point.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-cream/80">{point.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SectionHeading({ eyebrow, title, href, linkLabel }: { eyebrow: string; title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="flex items-end justify-between gap-6 border-b border-line pb-5">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="mt-2 text-3xl font-medium text-ink md:text-[2.5rem]">{title}</h2>
      </div>
      {href && linkLabel && (
        <Link href={href} className="hidden shrink-0 items-center gap-1.5 text-sm font-semibold text-sage-dark hover:text-sage sm:inline-flex">
          {linkLabel} <ArrowRightIcon size={16} />
        </Link>
      )}
    </div>
  );
}

import Link from "next/link";
import { AlertIcon, ArrowDownIcon, ClockIcon, LeafIcon, PinterestIcon, ServingsIcon } from "@/components/icons";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { absoluteUrl } from "@/lib/env";
import { ALLERGEN_LABELS, type Allergen } from "@/lib/automation/allergens";
import { analyzeIngredients, type IngredientFinding } from "@/lib/recipes/gluten";
import { formatDate, formatMinutes, totalMinutes } from "@/lib/recipes/format";
import type { Ingredient, InstructionStep, Nutrition, RecipeCardData, RecipeWithCategory } from "@/lib/recipes/types";
import { pinterestSaveUrl } from "@/lib/pinterest";
import { RecipeGrid } from "./recipe-card";
import { PrintButton } from "./recipe-actions";
import { RecipeImage } from "./recipe-image";

interface RecipeArticleProps {
  recipe: RecipeWithCategory;
  related: RecipeCardData[];
}

/** Full recipe page body. Used by the public page and the admin draft preview. */
export function RecipeArticle({ recipe, related }: RecipeArticleProps) {
  const total = totalMinutes(recipe.prep_time, recipe.cook_time);
  const findings = analyzeIngredients(recipe.ingredients);
  const labelFindings = findings.filter((f) => f.severity === "check_label");
  const findingByIndex = new Map(findings.map((f) => [f.index, f]));
  const pinImage = recipe.pinterest_image || recipe.featured_image;
  const pageUrl = absoluteUrl(`/recipes/${recipe.slug}`);

  const crumbs = [
    { name: "Home", href: "/" },
    ...(recipe.category ? [{ name: recipe.category.name, href: `/categories/${recipe.category.slug}` }] : [{ name: "Recipes", href: "/recipes" }]),
    { name: recipe.title, href: `/recipes/${recipe.slug}` },
  ];

  const times = [
    { label: "Prep time", value: formatMinutes(recipe.prep_time) },
    { label: "Cook time", value: formatMinutes(recipe.cook_time) },
    { label: "Total time", value: formatMinutes(total) },
    { label: "Servings", value: recipe.servings != null ? String(recipe.servings) : "" },
  ].filter((t) => t.value);

  return (
    <article className="print-root">
      <header className="print-hidden container-page pt-8 md:pt-12">
        <div className="mx-auto max-w-3xl">
          <Breadcrumbs items={crumbs} />
          {recipe.category && (
            <p className="eyebrow mt-8">
              <Link href={`/categories/${recipe.category.slug}`} className="hover:text-sage-dark">
                {recipe.category.name}
              </Link>
            </p>
          )}
          <h1 className="mt-3 text-[2.4rem] font-medium leading-[1.08] text-ink sm:text-5xl md:text-[3.5rem]">{recipe.title}</h1>
          {recipe.description && <p className="mt-5 text-lg leading-relaxed text-ink-soft md:text-xl">{recipe.description}</p>}

          <dl className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
            {times.map((t) => (
              <div key={t.label} className="bg-card px-4 py-3.5">
                <dt className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-faint">{t.label}</dt>
                <dd className="mt-1 font-serif text-lg text-ink">{t.value}</dd>
              </div>
            ))}
          </dl>

          <div className="print-hidden mt-6 flex flex-wrap items-center gap-3">
            <a href="#recipe-card" className="btn btn-primary">
              <ArrowDownIcon size={18} /> Jump to Recipe
            </a>
            <PrintButton />
            {pinImage && <PinterestButton url={pageUrl} media={absoluteUrl(pinImage)} description={recipe.title} />}
          </div>

        </div>
      </header>

      <figure className="print-hidden container-page mt-10">
        <div className="relative mx-auto aspect-[3/2] max-w-5xl overflow-hidden rounded-[1.75rem] bg-cream-deep">
          <RecipeImage
            src={recipe.featured_image}
            alt={recipe.featured_image_alt}
            categorySlug={recipe.category?.slug}
            sizes="(min-width: 1100px) 1024px, 100vw"
            priority
          />
        </div>
        {recipe.image_source === "ai" && recipe.featured_image && (
          <figcaption className="mx-auto mt-2 max-w-5xl text-right text-xs text-ink-faint">AI-generated image of the finished dish.</figcaption>
        )}
      </figure>

      <div className="container-page">
        <div className="mx-auto max-w-3xl">
          <section className="print-hidden prose-recipe mt-12" aria-label="Introduction">
            {recipe.introduction.split(/\n{2,}/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            {recipe.published_at && (
              <p className="mt-6 text-sm text-ink-faint">
                Published {formatDate(recipe.published_at)}
                {recipe.updated_at && formatDate(recipe.updated_at) !== formatDate(recipe.published_at) && <> · Updated {formatDate(recipe.updated_at)}</>}
              </p>
            )}
          </section>

          {recipe.tips.length > 0 && (
            <Section title="Tips for success" id="tips">
              <ul className="space-y-3">
                {recipe.tips.map((tip, i) => (
                  <li key={i} className="flex gap-3 leading-relaxed">
                    <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sage" aria-hidden="true" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {recipe.substitutions.length > 0 && (
            <Section title="Ingredient substitutions" id="substitutions">
              <div className="overflow-hidden rounded-2xl border border-line bg-card">
                <table className="w-full text-left text-[0.95rem]">
                  <thead className="bg-cream-deep/60 text-xs uppercase tracking-[0.1em] text-ink-faint">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold">Instead of</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Use</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {recipe.substitutions.map((s, i) => (
                      <tr key={i} className="align-top">
                        <td className="px-4 py-3.5 font-medium text-ink">{s.original}</td>
                        <td className="px-4 py-3.5 text-ink-soft">
                          <span className="text-ink">{s.substitute}</span>
                          {s.note && <span className="mt-1 block text-sm">{s.note}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          <GlutenFreeNotes findings={labelFindings} />

          <RecipeCardSection recipe={recipe} findingByIndex={findingByIndex} total={total} pinImage={pinImage} pageUrl={pageUrl} />

          {recipe.faq.length > 0 && (
            <Section title="Frequently asked questions" id="faq">
              <div className="divide-y divide-line rounded-2xl border border-line bg-card">
                {recipe.faq.map((item, i) => (
                  <div key={i} className="px-5 py-5 md:px-6">
                    <h3 className="font-serif text-lg font-medium text-ink">{item.question}</h3>
                    <p className="mt-2 leading-relaxed text-ink-soft">{item.answer}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section className="print-hidden container-page mt-20" aria-labelledby="related-heading">
          <div className="border-b border-line pb-5">
            <p className="eyebrow">Keep cooking</p>
            <h2 id="related-heading" className="mt-2 text-3xl font-medium text-ink">
              You might also like
            </h2>
          </div>
          <div className="mt-8">
            <RecipeGrid recipes={related} />
          </div>
        </section>
      )}
    </article>
  );
}

function Section({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <section id={id} className="print-hidden mt-14 scroll-mt-24" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="mb-5 text-[1.85rem] font-medium text-ink">
        {title}
      </h2>
      <div className="text-[1.0625rem] text-ink">{children}</div>
    </section>
  );
}

function GlutenFreeNotes({ findings }: { findings: IngredientFinding[] }) {
  return (
    <section id="gluten-free-notes" className="print-hidden mt-14 scroll-mt-24 rounded-2xl border border-sage-light/50 bg-sage-wash/60 p-6 md:p-7" aria-labelledby="gf-notes-heading">
      <h2 id="gf-notes-heading" className="flex items-center gap-2.5 font-serif text-2xl font-medium text-ink">
        <LeafIcon size={22} className="text-sage" /> Gluten-free kitchen notes
      </h2>
      {findings.length > 0 && (
        <>
          <p className="mt-4 text-[0.95rem] font-semibold text-ink">Check the label on these ingredients:</p>
          <ul className="mt-3 space-y-2.5 text-[0.95rem] leading-relaxed text-ink-soft">
            {findings.map((f) => (
              <li key={f.index} className="flex gap-2.5">
                <AlertIcon size={16} className="mt-1 shrink-0 text-honey" />
                <span>
                  <span className="font-medium text-ink">{f.ingredient}:</span> {f.message}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">
        <span className="font-semibold text-ink">Avoid cross-contact.</span> Use clean pans, utensils, cutting boards and
        colanders, and a toaster or oven rack that has not been used for wheat products. Store gluten-free flours separately
        and wipe down counters before you start.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-ink-faint">
        This recipe uses gluten-free ingredients, but we cannot guarantee it is safe for everyone with celiac disease or
        gluten sensitivity. Read our <Link href="/recipe-disclaimer" className="underline underline-offset-2 hover:text-sage-dark">recipe disclaimer</Link>.
      </p>
    </section>
  );
}

function RecipeCardSection({
  recipe,
  findingByIndex,
  total,
  pinImage,
  pageUrl,
}: {
  recipe: RecipeWithCategory;
  findingByIndex: Map<number, IngredientFinding>;
  total: number | null;
  pinImage: string | null;
  pageUrl: string;
}) {
  const ingredientGroups = groupBy(recipe.ingredients.map((ing, index) => ({ ing, index })), (x) => x.ing.group);
  // Only AI recipes have a checked allergen declaration; manual ones leave it empty.
  const allergens = recipe.source === "ai" ? (recipe.allergens ?? []).flatMap((a) => (a in ALLERGEN_LABELS ? [ALLERGEN_LABELS[a as Allergen]] : [])) : [];
  const stepGroups = groupBy(recipe.instructions.map((step, index) => ({ step, index })), (x) => x.step.group);

  return (
    <section id="recipe-card" className="mt-16 scroll-mt-24 overflow-hidden rounded-[1.75rem] border border-line-strong bg-card shadow-card" aria-labelledby="recipe-card-heading">
      <div className="flex flex-col gap-5 border-b border-line p-6 sm:flex-row sm:items-start md:p-8">
        <div className="relative hidden h-28 w-28 shrink-0 overflow-hidden rounded-2xl bg-cream-deep sm:block">
          <RecipeImage src={recipe.featured_image} alt={recipe.featured_image_alt} categorySlug={recipe.category?.slug} sizes="112px" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Recipe</p>
          <h2 id="recipe-card-heading" className="mt-1.5 text-3xl font-medium leading-tight text-ink">
            {recipe.title}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-ink-soft">
            {recipe.prep_time != null && (
              <li className="flex items-center gap-1.5">
                <ClockIcon size={16} className="text-sage" /> Prep {formatMinutes(recipe.prep_time)}
              </li>
            )}
            {recipe.cook_time != null && <li>Cook {formatMinutes(recipe.cook_time)}</li>}
            {total != null && <li>Total {formatMinutes(total)}</li>}
            {recipe.servings != null && (
              <li className="flex items-center gap-1.5">
                <ServingsIcon size={16} className="text-sage" /> {recipe.yield_description || `${recipe.servings} servings`}
              </li>
            )}
          </ul>
          <div className="print-hidden mt-4 flex flex-wrap gap-2">
            <PrintButton className="btn btn-secondary px-4 py-2.5 text-sm" />
            {pinImage && <PinterestButton url={pageUrl} media={absoluteUrl(pinImage)} description={recipe.title} compact />}
          </div>
        </div>
      </div>

      <div className="grid gap-10 p-6 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)] md:p-8">
        <div>
          <h3 className="font-serif text-2xl font-medium text-ink">Ingredients</h3>
          {ingredientGroups.map(([group, items]) => (
            <div key={group ?? "_"} className="mt-5">
              {group && <h4 className="mb-2 font-sans text-sm font-semibold uppercase tracking-[0.08em] text-sage-dark">{group}</h4>}
              <ul className="divide-y divide-line/70">
                {items.map(({ ing, index }) => (
                  <IngredientRow key={index} ingredient={ing} finding={findingByIndex.get(index)} />
                ))}
              </ul>
            </div>
          ))}
          {allergens.length > 0 && (
            <p className="mt-5 rounded-xl bg-cream-deep/60 px-4 py-3 text-sm text-ink-soft">
              <strong className="font-semibold text-ink">Contains:</strong> {allergens.join(", ")}. Check labels on packaged ingredients for other allergens.
            </p>
          )}
        </div>
        <div>
          <h3 className="font-serif text-2xl font-medium text-ink">Instructions</h3>
          {stepGroups.map(([group, items]) => (
            <div key={group ?? "_"} className="mt-5">
              {group && <h4 className="mb-2 font-sans text-sm font-semibold uppercase tracking-[0.08em] text-sage-dark">{group}</h4>}
              <ol className="space-y-5">
                {items.map(({ step, index }) => (
                  <StepRow key={index} step={step} number={index + 1} />
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>

      {recipe.storage_instructions && (
        <div className="border-t border-line px-6 py-6 md:px-8">
          <h3 className="font-serif text-xl font-medium text-ink">Storage</h3>
          <p className="mt-2 leading-relaxed text-ink-soft">{recipe.storage_instructions}</p>
        </div>
      )}

      {recipe.nutrition && <NutritionPanel nutrition={recipe.nutrition} />}

      <p className="border-t border-line bg-cream/60 px-6 py-4 text-xs leading-relaxed text-ink-faint md:px-8">
        Always check ingredient labels to confirm products are gluten-free. Not medical advice.
      </p>
    </section>
  );
}

function IngredientRow({ ingredient, finding }: { ingredient: Ingredient; finding?: IngredientFinding }) {
  const measure = [ingredient.amount, ingredient.unit].filter(Boolean).join(" ");
  return (
    <li className="flex gap-3 py-2.5 leading-snug">
      <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full border border-sage" aria-hidden="true" />
      <span>
        {measure && <strong className="font-semibold text-ink">{measure} </strong>}
        <span className="text-ink">{ingredient.name}</span>
        {ingredient.metric && <span className="text-ink-faint"> ({ingredient.metric})</span>}
        {ingredient.note && <span className="text-ink-soft">, {ingredient.note}</span>}
        {finding?.severity === "check_label" && (
          <span className="ml-1.5 inline-flex translate-y-[-1px] items-center rounded-full bg-honey-wash px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-wide text-honey">
            Check GF label
          </span>
        )}
      </span>
    </li>
  );
}

function StepRow({ step, number }: { step: InstructionStep; number: number }) {
  return (
    <li id={`step-${number}`} className="flex gap-4 scroll-mt-24">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sage text-sm font-semibold text-white">{number}</span>
      <p className="pt-1 leading-relaxed text-ink">{step.text}</p>
    </li>
  );
}

const NUTRIENTS: Array<[keyof Nutrition, string, string]> = [
  ["calories", "Calories", ""],
  ["protein_g", "Protein", "g"],
  ["carbohydrates_g", "Carbohydrates", "g"],
  ["fat_g", "Fat", "g"],
  ["saturated_fat_g", "Saturated fat", "g"],
  ["fiber_g", "Fiber", "g"],
  ["sugar_g", "Sugar", "g"],
  ["sodium_mg", "Sodium", "mg"],
];

function NutritionPanel({ nutrition }: { nutrition: Nutrition }) {
  const rows = NUTRIENTS.filter(([key]) => typeof nutrition[key] === "number");
  if (rows.length === 0) return null;
  return (
    <div className="border-t border-line px-6 py-6 md:px-8">
      <h3 className="font-serif text-xl font-medium text-ink">
        Nutrition {nutrition.is_estimate && <span className="font-sans text-sm font-normal text-ink-faint">(estimated, per {nutrition.per})</span>}
      </h3>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        {rows.map(([key, label, unit]) => (
          <div key={key} className="flex justify-between gap-2 border-b border-line/70 py-1.5">
            <dt className="text-ink-soft">{label}</dt>
            <dd className="font-medium text-ink">
              {String(nutrition[key])}
              {unit && ` ${unit}`}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-ink-faint">
        {nutrition.is_estimate ? "Nutrition values are estimates" : "Nutrition values"}
        {nutrition.method ? ` (${nutrition.method})` : ""} and will vary with the brands and exact amounts you use.
      </p>
    </div>
  );
}

function PinterestButton({ url, media, description, compact = false }: { url: string; media: string; description: string; compact?: boolean }) {
  return (
    <a
      href={pinterestSaveUrl({ url, media, description })}
      target="_blank"
      rel="noopener noreferrer"
      className={`btn bg-[#bd081c] text-white hover:bg-[#9e0717] ${compact ? "px-4 py-2.5 text-sm" : ""}`}
    >
      <PinterestIcon size={compact ? 16 : 18} /> Save
      <span className="sr-only"> to Pinterest (opens in a new tab)</span>
    </a>
  );
}

function groupBy<T>(items: T[], key: (item: T) => string | undefined): Array<[string | undefined, T[]]> {
  const groups: Array<[string | undefined, T[]]> = [];
  for (const item of items) {
    const k = key(item) || undefined;
    const last = groups[groups.length - 1];
    if (last && last[0] === k) last[1].push(item);
    else groups.push([k, [item]]);
  }
  return groups;
}

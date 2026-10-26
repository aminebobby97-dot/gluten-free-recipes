"use client";

import { useActionState, useState } from "react";
import { saveRecipeAction, type ActionState } from "@/app/admin/actions";
import { slugify } from "@/lib/recipes/format";
import type { Category, Recipe } from "@/lib/recipes/types";
import { ImageField } from "./image-field";
import { ListEditor } from "./list-editor";
import { SubmitButton } from "./submit-button";
import { IssueList, Notice } from "./ui";

const NUTRIENTS = [
  ["calories", "Calories"],
  ["protein_g", "Protein (g)"],
  ["carbohydrates_g", "Carbs (g)"],
  ["fat_g", "Fat (g)"],
  ["saturated_fat_g", "Sat. fat (g)"],
  ["fiber_g", "Fiber (g)"],
  ["sugar_g", "Sugar (g)"],
  ["sodium_mg", "Sodium (mg)"],
] as const;

export function RecipeForm({ recipe, categories }: { recipe: Recipe | null; categories: Pick<Category, "id" | "name">[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveRecipeAction, { ok: true, message: "" });
  const [title, setTitle] = useState(recipe?.title ?? "");
  const [slug, setSlug] = useState(recipe?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(recipe));
  const folder = recipe?.slug || "uploads";

  return (
    <form action={formAction} className="space-y-6">
      {recipe && <input type="hidden" name="id" value={recipe.id} />}

      <Section title="Basics">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Title" htmlFor="title">
            <input
              id="title"
              name="title"
              required
              minLength={3}
              maxLength={140}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
              className="field-input"
            />
          </Field>
          <Field label="URL slug" htmlFor="slug" hint={`/recipes/${slug || "your-recipe"}`}>
            <input
              id="slug"
              name="slug"
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              className="field-input font-mono text-sm"
            />
          </Field>
          <Field label="Category" htmlFor="category_id">
            <select id="category_id" name="category_id" defaultValue={recipe?.category_id ?? ""} className="field-input">
              <option value="">Choose a category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Focus keyword" htmlFor="focus_keyword">
            <input id="focus_keyword" name="focus_keyword" defaultValue={recipe?.focus_keyword ?? ""} className="field-input" maxLength={120} />
          </Field>
        </div>
        <Field label="Short description" htmlFor="description" hint="One or two sentences. Shown on cards and used as the default meta description.">
          <textarea id="description" name="description" rows={2} maxLength={500} defaultValue={recipe?.description ?? ""} className="field-input" />
        </Field>
        <Field label="Introduction" htmlFor="introduction" hint="Separate paragraphs with a blank line. No invented personal stories or testing claims.">
          <textarea id="introduction" name="introduction" rows={6} defaultValue={recipe?.introduction ?? ""} className="field-input" />
        </Field>
      </Section>

      <Section title="Time and servings">
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          <Field label="Prep time (minutes)" htmlFor="prep_time">
            <input id="prep_time" name="prep_time" type="number" min={0} max={2880} defaultValue={recipe?.prep_time ?? ""} className="field-input" />
          </Field>
          <Field label="Cook time (minutes)" htmlFor="cook_time">
            <input id="cook_time" name="cook_time" type="number" min={0} max={2880} defaultValue={recipe?.cook_time ?? ""} className="field-input" />
          </Field>
          <Field label="Servings" htmlFor="servings">
            <input id="servings" name="servings" type="number" min={1} max={200} defaultValue={recipe?.servings ?? ""} className="field-input" />
          </Field>
          <Field label="Yield (optional)" htmlFor="yield_description">
            <input id="yield_description" name="yield_description" placeholder="e.g. 12 muffins" defaultValue={recipe?.yield_description ?? ""} className="field-input" />
          </Field>
        </div>
      </Section>

      <Section title="Ingredients">
        <ListEditor
          name="ingredients"
          label="Ingredients"
          hint="Use exact US measurements. Name gluten-free products explicitly (for example “gluten-free all-purpose flour blend”)."
          addLabel="Add ingredient"
          initial={(recipe?.ingredients ?? []) as unknown as Array<Record<string, unknown>>}
          fields={[
            { key: "amount", label: "Amount", placeholder: "1 1/2", span: 2 },
            { key: "unit", label: "Unit", placeholder: "cups", span: 2 },
            { key: "name", label: "Ingredient", placeholder: "gluten-free flour blend", span: 4 },
            { key: "note", label: "Note", placeholder: "sifted", span: 2 },
            { key: "metric", label: "Metric", placeholder: "210 g", span: 2 },
            { key: "group", label: "Group (optional)", placeholder: "For the sauce", span: 12 },
          ]}
        />
      </Section>

      <Section title="Instructions">
        <ListEditor
          name="instructions"
          label="Steps"
          numbered
          addLabel="Add step"
          initial={(recipe?.instructions ?? []) as unknown as Array<Record<string, unknown>>}
          fields={[
            { key: "text", label: "Instruction", multiline: true, span: 12 },
            { key: "group", label: "Group (optional)", placeholder: "Group heading, e.g. Make the sauce", span: 12 },
          ]}
        />
      </Section>

      <Section title="Tips, substitutions and storage">
        <ListEditor name="tips" label="Recipe tips" addLabel="Add tip" initial={(recipe?.tips ?? []).map((text) => ({ text }))} fields={[{ key: "text", label: "Tip", multiline: true }]} />
        <ListEditor
          name="substitutions"
          label="Ingredient substitutions"
          addLabel="Add substitution"
          initial={(recipe?.substitutions ?? []) as unknown as Array<Record<string, unknown>>}
          fields={[
            { key: "original", label: "Instead of", span: 4 },
            { key: "substitute", label: "Use", span: 4 },
            { key: "note", label: "Note", span: 4 },
          ]}
        />
        <Field label="Storage instructions" htmlFor="storage_instructions">
          <textarea id="storage_instructions" name="storage_instructions" rows={3} defaultValue={recipe?.storage_instructions ?? ""} className="field-input" />
        </Field>
      </Section>

      <Section title="Frequently asked questions">
        <ListEditor
          name="faq"
          label="FAQ"
          addLabel="Add question"
          initial={(recipe?.faq ?? []) as unknown as Array<Record<string, unknown>>}
          fields={[
            { key: "question", label: "Question", span: 12 },
            { key: "answer", label: "Answer", multiline: true, span: 12 },
          ]}
        />
      </Section>

      <Section title="Nutrition estimate (optional)">
        <p className="text-sm text-ink-soft">
          Leave blank unless you have calculated values from a reliable source. Values are always shown as estimates.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <Field label="Per" htmlFor="nutrition_per">
            <input id="nutrition_per" name="nutrition_per" placeholder="1 serving" defaultValue={recipe?.nutrition?.per ?? ""} className="field-input" />
          </Field>
          {NUTRIENTS.map(([key, label]) => (
            <Field key={key} label={label} htmlFor={`nutrition_${key}`}>
              <input id={`nutrition_${key}`} name={`nutrition_${key}`} type="number" step="any" min={0} defaultValue={recipe?.nutrition?.[key] ?? ""} className="field-input" />
            </Field>
          ))}
        </div>
        <Field label="Method / source" htmlFor="nutrition_method" hint="For example: Calculated with USDA FoodData Central.">
          <input id="nutrition_method" name="nutrition_method" defaultValue={recipe?.nutrition?.method ?? ""} className="field-input" />
        </Field>
      </Section>

      <Section title="Images">
        <ImageField label="Featured image" name="featured_image" altName="featured_image_alt" initialUrl={recipe?.featured_image ?? null} initialAlt={recipe?.featured_image_alt ?? null} folder={folder} hint="Landscape, at least 1600px wide." />
        <ImageField label="Pinterest image (optional)" name="pinterest_image" altName="pinterest_image_alt" initialUrl={recipe?.pinterest_image ?? null} initialAlt={recipe?.pinterest_image_alt ?? null} folder={`${folder}/pinterest`} hint="Portrait 2:3, for example 1000 × 1500px." />
      </Section>

      <Section title="Search appearance">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="SEO title" htmlFor="seo_title" hint="Defaults to the recipe title. Aim for 60 characters or fewer.">
            <input id="seo_title" name="seo_title" maxLength={70} defaultValue={recipe?.seo_title ?? ""} className="field-input" />
          </Field>
          <Field label="SEO description" htmlFor="seo_description" hint="Defaults to the short description. Aim for 120 to 160 characters.">
            <textarea id="seo_description" name="seo_description" rows={2} maxLength={170} defaultValue={recipe?.seo_description ?? ""} className="field-input" />
          </Field>
        </div>
      </Section>

      <Section title="Testing">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="is_tested" defaultChecked={recipe?.is_tested ?? false} className="mt-1 h-4 w-4 accent-[var(--color-sage)]" />
          <span>
            <span className="font-semibold text-ink">This recipe has been cooked and confirmed to work as written.</span>
            <span className="block text-ink-soft">Leave unchecked otherwise. This is kept for your records and is not shown on the site.</span>
          </span>
        </label>
      </Section>

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-cream/95 px-4 py-4 backdrop-blur md:-mx-0 md:rounded-2xl md:border">
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel="Saving…">{recipe ? "Save changes" : "Create draft"}</SubmitButton>
          {state.message && <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice>}
        </div>
        {state.issues && state.issues.length > 0 && (
          <div className="mt-3">
            <IssueList issues={state.issues} />
          </div>
        )}
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-line bg-card p-5 md:p-6">
      <h2 className="font-sans text-sm font-semibold uppercase tracking-[0.1em] text-ink-soft">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="field-label">
        {label}
      </label>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

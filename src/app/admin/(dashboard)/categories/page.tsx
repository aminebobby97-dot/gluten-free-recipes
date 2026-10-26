import { saveCategoryAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { listCategories } from "@/lib/data/admin";
import type { Category } from "@/lib/recipes/types";

export const metadata = { title: "Categories" };

export default async function AdminCategoriesPage() {
  const { supabase } = await requireAdmin();
  const categories = await listCategories(supabase);
  return (
    <div className="space-y-6">
      <PageHeader title="Categories" description="Each category has its own landing page at /categories/[slug]. Changes appear on the site immediately." />
      <div className="space-y-4">
        {categories.map((c) => (
          <details key={c.id} className="group rounded-2xl border border-line bg-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
              <span>
                <span className="font-serif text-lg text-ink">{c.name}</span>
                <span className="ml-2 font-mono text-xs text-ink-faint">/categories/{c.slug}</span>
              </span>
              <span className="text-sm text-sage-dark group-open:hidden">Edit</span>
              <span className="hidden text-sm text-ink-faint group-open:inline">Close</span>
            </summary>
            <div className="border-t border-line px-5 py-5">
              <CategoryForm category={c} />
            </div>
          </details>
        ))}
        <details className="rounded-2xl border border-dashed border-line-strong bg-card/60">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-sage-dark">+ Add a category</summary>
          <div className="border-t border-line px-5 py-5">
            <CategoryForm category={null} />
          </div>
        </details>
      </div>
    </div>
  );
}

function CategoryForm({ category }: { category: Category | null }) {
  const field = (name: keyof Category, label: string, opts: { multiline?: boolean; max?: number; hint?: string; mono?: boolean } = {}) => {
    const id = `${category?.id ?? "new"}-${name}`;
    const value = category?.[name] ?? "";
    return (
      <div className={opts.multiline ? "md:col-span-2" : ""}>
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        {opts.multiline ? (
          <textarea id={id} name={name} rows={4} defaultValue={String(value)} maxLength={opts.max} className="field-input" />
        ) : (
          <input id={id} name={name} defaultValue={String(value)} maxLength={opts.max} className={`field-input ${opts.mono ? "font-mono text-sm" : ""}`} />
        )}
        {opts.hint && <p className="field-hint">{opts.hint}</p>}
      </div>
    );
  };
  return (
    <ActionForm action={saveCategoryAction} hidden={category ? { id: category.id } : undefined}>
      <div className="grid gap-4 md:grid-cols-2">
        {field("name", "Name", { max: 80 })}
        {field("short_name", "Short name (navigation)", { max: 40 })}
        {field("slug", "Slug", { mono: true, hint: "Changing a slug changes the page URL." })}
        {field("sort_order", "Sort order")}
        {field("description", "Short description", { multiline: true, max: 500 })}
        {field("introduction", "Landing page introduction", { multiline: true, max: 5000 })}
        {field("seo_title", "SEO title", { max: 70 })}
        {field("seo_description", "SEO description", { max: 170 })}
        {field("image_url", "Image URL (optional)")}
        {field("image_alt", "Image alt text", { max: 250 })}
      </div>
      <div className="mt-4">
        <SubmitButton>{category ? "Save category" : "Create category"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteRecipeAction, publishRecipeAction, unpublishRecipeAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { RecipeForm } from "@/components/admin/recipe-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { IssueList, Notice, PageHeader, Panel, StatusBadge, formatDateTime } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { listCategories } from "@/lib/data/admin";
import { analyzeIngredients } from "@/lib/recipes/gluten";
import { getPublishReadiness } from "@/lib/recipes/validation";
import { ServiceError } from "@/lib/services/errors";
import { getRecipeById } from "@/lib/services/recipes";

export const metadata = { title: "Edit recipe" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditRecipePage({ params, searchParams }: PageProps<"/admin/recipes/[id]">) {
  const { supabase } = await requireAdmin();
  const { id } = await params;
  const query = await searchParams;
  if (!UUID.test(id)) notFound();

  let recipe;
  try {
    recipe = await getRecipeById(supabase, id);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "not_found") notFound();
    throw error;
  }
  const categories = await listCategories(supabase);
  const readiness = getPublishReadiness(recipe);
  const labelChecks = analyzeIngredients(recipe.ingredients).filter((f) => f.severity === "check_label");
  const isLive = recipe.status === "published";

  return (
    <div className="space-y-6">
      <PageHeader
        title={recipe.title}
        description={`/recipes/${recipe.slug}`}
        actions={
          <>
            <Link href={`/admin/recipes/${recipe.id}/preview`} className="btn btn-secondary">
              Preview
            </Link>
            {isLive && (
              <Link href={`/recipes/${recipe.slug}`} className="btn btn-secondary">
                View live ↗
              </Link>
            )}
          </>
        }
      />
      {query.created && <Notice tone="success">Draft created.</Notice>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-2 xl:order-1">
          <RecipeForm recipe={recipe} categories={categories} />
        </div>
        <aside className="order-1 space-y-4 xl:order-2 xl:sticky xl:top-6 xl:self-start">
          <Panel title="Publishing">
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-soft">Status</span>
              <StatusBadge status={recipe.status} />
            </div>
            {recipe.published_at && <p className="mt-2 text-xs text-ink-faint">First published {formatDateTime(recipe.published_at)}</p>}
            <div className="mt-4">
              {isLive ? (
                <ActionForm action={unpublishRecipeAction} hidden={{ id: recipe.id }}>
                  <SubmitButton className="btn btn-secondary w-full" pendingLabel="Unpublishing…">
                    Unpublish
                  </SubmitButton>
                </ActionForm>
              ) : (
                <ActionForm action={publishRecipeAction} hidden={{ id: recipe.id }}>
                  <SubmitButton className="btn btn-primary w-full" pendingLabel="Publishing…">
                    Publish
                  </SubmitButton>
                  {!readiness.ready && <p className="mt-2 text-xs text-ink-faint">Fix the blocking issues below before publishing. Save the form first if you changed anything.</p>}
                </ActionForm>
              )}
            </div>
          </Panel>

          <Panel title={readiness.ready ? "Ready to publish" : `${readiness.errors.length} blocking issue(s)`}>
            {readiness.ready ? <p className="text-sm text-sage-dark">All required fields are complete and the gluten checks passed.</p> : <IssueList issues={readiness.errors} />}
            {readiness.warnings.length > 0 && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-faint">Suggestions</p>
                <IssueList issues={readiness.warnings} tone="warning" />
              </div>
            )}
          </Panel>

          {labelChecks.length > 0 && (
            <Panel title="Label checks shown to readers">
              <ul className="space-y-2 text-sm text-ink-soft">
                {labelChecks.map((f) => (
                  <li key={f.index}>
                    <span className="font-medium text-ink">{f.ingredient}</span>: {f.message}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {!isLive && (
            <Panel title="Delete">
              <ActionForm action={deleteRecipeAction} hidden={{ id: recipe.id }}>
                <label htmlFor="confirm" className="field-hint mb-1.5 block">
                  Type <strong>delete</strong> to permanently remove this draft.
                </label>
                <input id="confirm" name="confirm" className="field-input text-sm" autoComplete="off" />
                <SubmitButton className="btn mt-2 w-full border border-danger/40 text-danger hover:bg-danger-wash" pendingLabel="Deleting…">
                  Delete draft
                </SubmitButton>
              </ActionForm>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

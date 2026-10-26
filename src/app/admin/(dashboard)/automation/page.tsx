import Link from "next/link";
import { saveAutomationSettingsAction } from "@/app/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { Notice, PageHeader, Panel, formatDateTime } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/auth/admin";
import { getAutomationOverview } from "@/lib/data/automation";

export const metadata = { title: "Automation" };

export default async function AdminAutomationPage() {
  const { supabase } = await requireAdmin();
  const overview = await getAutomationOverview(supabase);

  if (!overview.installed) {
    return (
      <div className="space-y-6">
        <PageHeader title="Automation" description="Daily AI recipe generation." />
        <Notice>
          Automation is not installed yet. Its database tables are created by the Phase 2 migration, which has not been applied. The rest of the
          dashboard works as before.
        </Notice>
      </div>
    );
  }

  const { settings, spentTodayUsd, approvedAiRecipes, inReviewAiRecipes } = overview;
  const autoUnlocked = approvedAiRecipes >= settings.min_reviewed_before_auto;
  const stats = [
    { label: "Automation", value: settings.enabled ? "On" : "Off" },
    { label: "Mode", value: settings.publish_mode === "auto" && autoUnlocked ? "Automatic" : "Review" },
    { label: "AI recipes approved", value: `${approvedAiRecipes} / ${settings.min_reviewed_before_auto}` },
    { label: "AI spend today", value: `$${spentTodayUsd.toFixed(2)} / $${settings.daily_budget_usd.toFixed(2)}` },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Automation" description="One AI-written recipe a day, with photos, checked before anything is saved." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-line bg-card p-5">
            <p className="text-sm text-ink-soft">{s.label}</p>
            <p className="mt-2 font-serif text-3xl text-ink">{s.value}</p>
          </div>
        ))}
      </div>

      {inReviewAiRecipes > 0 && (
        <Notice>
          {inReviewAiRecipes} AI recipe(s) are waiting for your review.{" "}
          <Link href="/admin/recipes?status=in_review" className="font-semibold underline">
            Review them
          </Link>
          . Publishing one counts as an approval.
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Settings">
          <ActionForm action={saveAutomationSettingsAction} className="space-y-5">
            <label className="flex items-start gap-3">
              <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="mt-1 h-4 w-4" />
              <span>
                <span className="font-medium text-ink">Generate a recipe each day</span>
                <span className="field-hint block">
                  Also needs the AUTOMATION_ENABLED variable set to true in GitHub. Test runs (dry runs) work while this is off.
                </span>
              </span>
            </label>

            <div>
              <label htmlFor="publish_mode" className="field-label">
                Publishing
              </label>
              <select id="publish_mode" name="publish_mode" defaultValue={settings.publish_mode} className="field-input">
                <option value="review">Review: save each recipe for my approval</option>
                <option value="auto">Automatic: publish recipes that pass every check</option>
              </select>
              <p className="field-hint mt-1.5">
                Automatic publishing stays locked until {settings.min_reviewed_before_auto} AI recipes have been approved
                {autoUnlocked ? " (done)." : `; ${settings.min_reviewed_before_auto - approvedAiRecipes} to go.`} Until then, recipes are saved for review.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="daily_budget_usd" className="field-label">
                  Daily AI budget (USD)
                </label>
                <input id="daily_budget_usd" name="daily_budget_usd" type="number" min={0.5} max={100} step={0.5} defaultValue={settings.daily_budget_usd} className="field-input" />
                <p className="field-hint mt-1.5">The run stops before any AI call that could go over this.</p>
              </div>
              <div>
                <label htmlFor="max_keyword_difficulty" className="field-label">
                  Hardest keyword to target (0 to 100)
                </label>
                <input id="max_keyword_difficulty" name="max_keyword_difficulty" type="number" min={0} max={100} step={1} defaultValue={settings.max_keyword_difficulty ?? 40} className="field-input" />
                <p className="field-hint mt-1.5">Keywords with a higher difficulty in your import are skipped. Keywords without one are allowed.</p>
              </div>
            </div>

            <p className="text-sm text-ink-soft">Pinterest publishing: off until the Pinterest Business account and API access are ready.</p>
            <SubmitButton className="btn btn-primary" pendingLabel="Saving…">
              Save settings
            </SubmitButton>
            <p className="text-xs text-ink-faint">Last changed {formatDateTime(settings.updated_at)}</p>
          </ActionForm>
        </Panel>

        <Panel title="How a daily run works">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-soft">
            <li>Picks the best unused keyword that is not too similar to an existing recipe.</li>
            <li>Claude writes the recipe. Code checks gluten, allergens, timings, temperatures and SEO.</li>
            <li>A second, independent Claude review looks for errors. Failed drafts get one repair, then are rejected.</li>
            <li>OpenAI makes a site photo and a Pinterest photo; Claude checks they match the recipe.</li>
            <li>The recipe is saved for your review (or published, in automatic mode).</li>
          </ol>
          <p className="mt-4 text-sm text-ink-soft">
            Every step and its cost is logged under{" "}
            <Link href="/admin/jobs" className="text-sage-dark underline">
              Publishing jobs
            </Link>
            .
          </p>
        </Panel>
      </div>
    </div>
  );
}

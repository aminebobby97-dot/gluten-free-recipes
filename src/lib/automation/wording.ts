// Applies the AI reviewer's small wording fixes in code.
//
// When the reviewer finds a minor, easily repaired wording problem in a
// recipe's prose (for example "preheat the pan to burn off any gluten"), it
// reports it as kind "wording" with the exact text to replace and the
// corrected text. Applying that here costs nothing and avoids failing an
// otherwise good recipe on its last check. Every code check runs again on the
// result, so a replacement cannot slip anything past them.
//
// Only prose is ever changed: never the title, slug, ingredients, quantities,
// times, servings or allergens. An issue whose quote cannot be found exactly
// once in its field is left as it was, and still blocks.

import type { GeneratedRecipe, ReviewIssue } from "./types";

/** A replacement may add a little context, never a new paragraph. */
const MAX_GROWTH = 400;

type Path =
  | { kind: "top"; key: "description" | "introduction" | "storage_instructions" }
  | { kind: "instruction"; index: number }
  | { kind: "tip"; index: number }
  | { kind: "faq"; index: number; key: "question" | "answer" }
  | { kind: "substitution"; index: number };

/** Parses the reviewer's field name ("instructions[2]", "faq[1].answer", "tips[0]") into an editable prose field. */
export function parseProseField(field: string): Path | null {
  const f = field.trim().replace(/\s+/g, "");
  if (f === "description" || f === "introduction" || f === "storage_instructions") return { kind: "top", key: f };
  let m = f.match(/^instructions\[(\d+)\](?:\.text)?$/);
  if (m) return { kind: "instruction", index: Number(m[1]) };
  m = f.match(/^tips\[(\d+)\]$/);
  if (m) return { kind: "tip", index: Number(m[1]) };
  m = f.match(/^faq\[(\d+)\](?:\.(question|answer))?$/);
  if (m) return { kind: "faq", index: Number(m[1]), key: (m[2] as "question" | "answer" | undefined) ?? "answer" };
  m = f.match(/^substitutions\[(\d+)\](?:\.note)?$/);
  if (m) return { kind: "substitution", index: Number(m[1]) };
  return null;
}

function read(recipe: GeneratedRecipe, path: Path): string | null {
  switch (path.kind) {
    case "top":
      return recipe[path.key] ?? null;
    case "instruction":
      return recipe.instructions[path.index]?.text ?? null;
    case "tip":
      return recipe.tips[path.index] ?? null;
    case "faq":
      return recipe.faq[path.index]?.[path.key] ?? null;
    case "substitution":
      return recipe.substitutions[path.index]?.note ?? null;
  }
}

function write(recipe: GeneratedRecipe, path: Path, value: string): GeneratedRecipe {
  switch (path.kind) {
    case "top":
      return { ...recipe, [path.key]: value };
    case "instruction":
      return { ...recipe, instructions: recipe.instructions.map((s, i) => (i === path.index ? { ...s, text: value } : s)) };
    case "tip":
      return { ...recipe, tips: recipe.tips.map((t, i) => (i === path.index ? value : t)) };
    case "faq":
      return { ...recipe, faq: recipe.faq.map((f, i) => (i === path.index ? { ...f, [path.key]: value } : f)) };
    case "substitution":
      return { ...recipe, substitutions: recipe.substitutions.map((s, i) => (i === path.index ? { ...s, note: value } : s)) };
  }
}

function occurrences(text: string, part: string): number {
  let count = 0;
  for (let at = text.indexOf(part); at !== -1; at = text.indexOf(part, at + part.length)) count++;
  return count;
}

export interface WordingFixResult {
  recipe: GeneratedRecipe;
  /** Blocking wording issues that were fixed in code. */
  applied: ReviewIssue[];
  /** Every other issue, unchanged. */
  rest: ReviewIssue[];
}

/** Applies each blocking "wording" issue that names an exact quote in a prose field. */
export function applyWordingFixes(recipe: GeneratedRecipe, issues: ReviewIssue[]): WordingFixResult {
  let current = recipe;
  const applied: ReviewIssue[] = [];
  const rest: ReviewIssue[] = [];
  for (const issue of issues) {
    const fixed = issue.severity === "blocking" && issue.kind === "wording" ? tryFix(current, issue) : null;
    if (fixed) {
      current = fixed;
      applied.push(issue);
    } else {
      rest.push(issue);
    }
  }
  return { recipe: current, applied, rest };
}

function tryFix(recipe: GeneratedRecipe, issue: ReviewIssue): GeneratedRecipe | null {
  const quote = issue.quote?.trim();
  const replacement = (issue.replacement ?? "").trim();
  if (!quote) return null;
  if (replacement.length > quote.length + MAX_GROWTH) return null;
  const path = parseProseField(issue.field);
  if (!path) return null;
  const value = read(recipe, path);
  if (value == null || occurrences(value, quote) !== 1) return null;
  const next = value.replace(quote, () => replacement).replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
  // A field the fix would empty needs a real rewrite.
  if (!next || next.length < 3) return null;
  return write(recipe, path, next);
}

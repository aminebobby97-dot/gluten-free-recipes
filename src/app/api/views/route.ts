import { NextResponse } from "next/server";
import { isValidSlug } from "@/lib/recipes/format";
import { createPublicClient } from "@/lib/supabase/public";

// Records a page view for a published recipe. The database function ignores
// slugs that are not published, so this endpoint cannot create or change content.
export async function POST(request: Request) {
  let slug: unknown;
  try {
    ({ slug } = await request.json());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (typeof slug !== "string" || !isValidSlug(slug)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Ignore obvious bots so crawlers do not inflate popularity.
  const ua = request.headers.get("user-agent") ?? "";
  if (/bot|crawl|spider|slurp|preview|headless/i.test(ua)) {
    return new NextResponse(null, { status: 204 });
  }

  const supabase = createPublicClient();
  if (!supabase) return new NextResponse(null, { status: 204 });

  const { error } = await supabase.rpc("increment_recipe_view", { p_slug: slug });
  if (error) {
    console.error("increment_recipe_view failed", error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}

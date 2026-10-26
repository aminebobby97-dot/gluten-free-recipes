import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isValidSlug } from "@/lib/recipes/format";
import { revalidateRecipe } from "@/lib/services/revalidate";

// Lets the publishing worker (which runs outside this app, in GitHub Actions)
// expire cached recipe pages after it publishes. Requires the shared
// REVALIDATE_SECRET as a bearer token. It can only mark cached pages stale; it
// cannot read or change any content.

function isAuthorized(request: Request): boolean {
  const secret = process.env.REVALIDATE_SECRET?.trim();
  if (!secret || secret.length < 32) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  let slug: unknown;
  try {
    ({ slug } = await request.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }
  if (slug !== undefined && (typeof slug !== "string" || !isValidSlug(slug))) {
    return NextResponse.json({ ok: false, error: "Invalid slug." }, { status: 400 });
  }

  revalidateRecipe(slug as string | undefined);
  return NextResponse.json({ ok: true, revalidated: slug ?? null }, { headers: { "Cache-Control": "no-store" } });
}

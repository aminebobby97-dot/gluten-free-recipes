import { NextResponse, type NextRequest } from "next/server";
import { getAdminSession } from "@/lib/auth/admin";
import { PinterestApiError } from "@/lib/services/pinterest-api";
import { OAUTH_STATE_COOKIE, PINTEREST_CALLBACK_PATH, completePinterestConnection, createPinterestDeps, getPinterestConfig, verifyOAuthState } from "@/lib/services/pinterest-connection";
import { ServiceError } from "@/lib/services/errors";

// Pinterest OAuth redirect URI (registered in Pinterest Developers as
// https://www.glutenfreerecipehub.com/api/pinterest/callback).
//
// Accepts the one-time code only when the signed-in user is an admin AND the
// `state` matches the signed, 10-minute cookie set when that same admin
// clicked Connect Pinterest (CSRF protection). The code is exchanged for
// tokens on the server; tokens are encrypted before they are saved and are
// never sent to the browser or written to logs.

function back(request: NextRequest, result: string) {
  const url = new URL("/admin/pinterest", request.url);
  url.searchParams.set("connect", result);
  const response = NextResponse.redirect(url, 303);
  // One use only, whatever happened.
  response.cookies.set(OAUTH_STATE_COOKIE, "", { path: PINTEREST_CALLBACK_PATH, maxAge: 0, httpOnly: true, sameSite: "lax", secure: url.protocol === "https:" });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const session = await getAdminSession();
  if (session.state !== "admin") {
    const login = new URL("/admin/login", request.url);
    login.searchParams.set("next", "/admin/pinterest");
    return NextResponse.redirect(login, 303);
  }

  const config = getPinterestConfig();
  if (!config.ok) return back(request, "not_configured");

  const stateOk = verifyOAuthState(config.config.stateKey, request.cookies.get(OAUTH_STATE_COOKIE)?.value, params.get("state"), session.user.id);
  if (!stateOk) return back(request, "state_mismatch");
  // The admin clicked "Cancel" on Pinterest's consent screen.
  if (params.get("error")) return back(request, "denied");
  const code = params.get("code");
  if (!code || code.length > 512) return back(request, "missing_code");

  try {
    await completePinterestConnection(session.supabase, code, session.user.id, createPinterestDeps());
  } catch (err) {
    // Messages from these errors never contain a token or the app secret.
    const reason = err instanceof PinterestApiError || err instanceof ServiceError ? err.message : "unexpected error";
    console.error(`Pinterest connection failed: ${reason}`);
    if (err instanceof PinterestApiError && err.status === 403) return back(request, "forbidden");
    return back(request, "failed");
  }
  return back(request, "connected");
}

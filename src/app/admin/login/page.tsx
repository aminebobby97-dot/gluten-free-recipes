import type { Metadata } from "next";
import { Suspense } from "react";
import { LogoMark } from "@/components/site/logo";
import { isSupabaseConfigured, siteConfig } from "@/lib/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/admin/login">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <LogoMark className="h-11 w-11" />
          <h1 className="mt-4 text-2xl font-medium text-ink">{siteConfig.name} admin</h1>
          <p className="mt-1 text-sm text-ink-soft">Sign in with your admin account.</p>
        </div>
        <div className="mt-8 rounded-2xl border border-line bg-card p-6 shadow-card">
          {isSupabaseConfigured() ? (
            <Suspense fallback={<LoginForm next="/admin" />}>
              <LoginWithParams searchParams={searchParams} />
            </Suspense>
          ) : (
            <p className="text-sm text-ink-soft">
              Supabase is not configured. Add the environment variables from <code>.env.example</code> and redeploy.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

async function LoginWithParams({ searchParams }: Pick<PageProps<"/admin/login">, "searchParams">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/admin";
  const forbidden = params.error === "forbidden";
  return <LoginForm next={next} initialError={forbidden ? "This account does not have admin access." : undefined} />;
}

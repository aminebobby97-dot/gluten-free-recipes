import Link from "next/link";
import { Suspense } from "react";
import { signOutAction } from "@/app/admin/actions";
import { AdminNav, AdminNavFallback } from "@/components/admin/admin-nav";
import { LogoMark } from "@/components/site/logo";
import { requireAdmin } from "@/lib/auth/admin";
import { siteConfig } from "@/lib/env";
import AdminLoading from "./loading";

export default function DashboardLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <aside className="border-b border-line bg-card lg:sticky lg:top-0 lg:h-dvh lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3 px-4 py-4 lg:flex-col lg:items-stretch lg:gap-6 lg:py-6">
          <Link href="/admin" className="flex items-center gap-2">
            <LogoMark className="h-8 w-8" />
            <span className="leading-tight">
              <span className="block font-serif text-base font-semibold">{siteConfig.name}</span>
              <span className="block text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-sage">Admin</span>
            </span>
          </Link>
          <Link href="/" className="text-xs font-medium text-ink-soft hover:text-sage-dark lg:order-last">
            View site ↗
          </Link>
        </div>
        <div className="px-3 pb-3 lg:pb-0">
          <Suspense fallback={<AdminNavFallback />}>
            <AdminNav />
          </Suspense>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <Suspense fallback={<AdminLoading />}>
          <AdminGate>{children}</AdminGate>
        </Suspense>
      </div>
    </div>
  );
}

/** Verifies the admin session (request-time) before rendering any admin page. */
async function AdminGate({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdmin();
  return (
    <>
      <div className="flex items-center justify-end gap-3 border-b border-line px-4 py-2.5 text-xs text-ink-soft md:px-8">
        <span>{user.email}</span>
        <form action={signOutAction}>
          <button type="submit" className="rounded-full px-3 py-1 font-semibold text-sage-dark hover:bg-sage-wash">
            Sign out
          </button>
        </form>
      </div>
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">{children}</div>
    </>
  );
}

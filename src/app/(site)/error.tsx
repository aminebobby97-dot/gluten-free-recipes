"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function SiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container-page flex flex-col items-center py-24 text-center">
      <p className="eyebrow">Something went wrong</p>
      <h1 className="mt-3 text-4xl font-medium text-ink">This page didn&apos;t load</h1>
      <p className="mt-4 max-w-md text-ink-soft">Please try again in a moment. If the problem continues, let us know.</p>
      <div className="mt-8 flex gap-3">
        <button type="button" onClick={reset} className="btn btn-primary">
          Try again
        </button>
        <Link href="/" className="btn btn-secondary">
          Go home
        </Link>
      </div>
    </div>
  );
}

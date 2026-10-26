"use client";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 md:px-8">
      <h1 className="text-2xl font-medium text-ink">This admin page failed to load</h1>
      <p className="mt-2 text-sm text-ink-soft">{error.message || "Unexpected error."}</p>
      {error.digest && <p className="mt-1 font-mono text-xs text-ink-faint">Reference: {error.digest}</p>}
      <button type="button" onClick={reset} className="btn btn-primary mt-6">
        Try again
      </button>
    </div>
  );
}

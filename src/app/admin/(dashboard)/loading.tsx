export default function AdminLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-56 animate-pulse rounded-lg bg-cream-deep" />
      <div className="mt-3 h-4 w-80 animate-pulse rounded bg-cream-deep" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-cream-deep" />
        ))}
      </div>
      <div className="mt-6 h-64 animate-pulse rounded-2xl bg-cream-deep" />
    </div>
  );
}

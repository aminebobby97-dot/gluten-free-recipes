"use client";

import "./globals.css";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-US">
      <body className="flex min-h-dvh items-center justify-center bg-cream p-6 text-center font-sans text-ink">
        <div>
          <h1 className="font-serif text-3xl">Something went wrong</h1>
          <p className="mt-3 text-ink-soft">Please refresh the page or try again later.</p>
          <button type="button" onClick={reset} className="btn btn-primary mt-6">
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

"use client";

import { useState } from "react";

/** Copies a piece of text (for example the recipe's URL) to the clipboard. */
export function CopyButton({ value, label = "Copy", className = "btn btn-secondary" }: { value: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("copied");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 2000);
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy it" : label}
    </button>
  );
}

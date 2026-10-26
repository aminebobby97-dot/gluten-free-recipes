"use client";

import { PrinterIcon } from "@/components/icons";

export function PrintButton({ className = "btn btn-secondary" }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      <PrinterIcon size={18} /> Print recipe
    </button>
  );
}

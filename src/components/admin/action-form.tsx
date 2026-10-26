"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/admin/actions";
import { IssueList, Notice } from "./ui";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** Small form wrapper that shows the result of a Server Action. */
export function ActionForm({ action, children, className = "", hidden }: { action: Action; children: React.ReactNode; className?: string; hidden?: Record<string, string> }) {
  const [state, formAction] = useActionState(action, { ok: true, message: "" });
  return (
    <form action={formAction} className={className}>
      {hidden && Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {children}
      {state.message && (
        <div className="mt-3 space-y-2">
          <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice>
          {state.issues && <IssueList issues={state.issues} />}
        </div>
      )}
    </form>
  );
}

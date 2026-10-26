"use client";

import { useActionState } from "react";
import { signInAction, type ActionState } from "@/app/admin/actions";
import { SubmitButton } from "@/components/admin/submit-button";
import { Notice } from "@/components/admin/ui";

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(signInAction, {
    ok: !initialError,
    message: initialError ?? "",
  });
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="field-label">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required className="field-input" />
      </div>
      <div>
        <label htmlFor="password" className="field-label">
          Password
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="field-input" />
      </div>
      {state.message && <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice>}
      <SubmitButton className="btn btn-primary w-full" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}

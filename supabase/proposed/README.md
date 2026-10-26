# Proposed migrations (not applied)

Files here are schema changes proposed for review. They live outside
`supabase/migrations/`, so `supabase db push` does not apply them.

| File | Purpose |
| --- | --- |
| `20261027000001_phase2_automation.sql` | Phase 2 daily recipe automation: settings (off by default), job event log, AI attempt log, checkpoints, duplicate check, atomic publish |
| `tests/phase2_automation_test.sql` | Checks for the migration above. Runs in a transaction that is rolled back |

To adopt a migration after approval: move it into `supabase/migrations/`, apply it
(`npx supabase db push`), then run the test file against the database:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/proposed/tests/phase2_automation_test.sql
```

Everything is additive. Existing tables keep their rows, policies and behaviour.

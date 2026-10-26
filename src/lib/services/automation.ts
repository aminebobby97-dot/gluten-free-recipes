// Switch for the daily publishing automation. The pipeline itself lives in
// src/lib/automation/pipeline.ts and runs only in the GitHub Actions worker
// (scripts/automation/run-daily.ts); nothing in the web app starts it.
//
// Automation runs only when AUTOMATION_ENABLED=true in the worker's
// environment AND automation_settings.enabled is true in the database.

export function isAutomationEnabled(): boolean {
  return process.env.AUTOMATION_ENABLED === "true";
}

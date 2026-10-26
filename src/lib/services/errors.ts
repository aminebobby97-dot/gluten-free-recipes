import type { ReadinessIssue } from "@/lib/recipes/validation";

export type ServiceErrorCode = "not_found" | "invalid_input" | "not_ready" | "conflict" | "database" | "disabled";

/** Error thrown by publishing services. `issues` explains validation failures. */
export class ServiceError extends Error {
  constructor(
    public readonly code: ServiceErrorCode,
    message: string,
    public readonly issues: ReadinessIssue[] = [],
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function dbError(context: string, error: { message: string; code?: string }): ServiceError {
  if (error.code === "23505") return new ServiceError("conflict", `${context}: a record with the same unique value already exists.`);
  return new ServiceError("database", `${context}: ${error.message}`);
}

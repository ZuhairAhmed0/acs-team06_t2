import {
  AppError,
  ConflictError,
  ServiceUnavailableError,
  UnprocessableContentError,
} from "./app-error.js";

export interface PostgresErrorLike {
  code?: string;
  routine?: string;
  severity?: string;
  detail?: string;
  schema?: string;
  table?: string;
  constraint?: string;
}

export function isDatabaseError(error: unknown): error is PostgresErrorLike {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as Record<string, unknown>).code === "string"
  );
}

/**
 * Maps known PostgreSQL error codes to conservative, client-safe AppError instances.
 *
 * Strict Security Guarantees:
 * - Never returns table names, column names, schema names, or constraint names in client messages.
 * - Never exposes SQL statements or parameters to clients.
 * - Unknown database errors return null so the centralized error handler can log them privately
 *   and emit a generic 500 INTERNAL_SERVER_ERROR.
 */
export function mapDatabaseError(error: unknown): AppError | null {
  if (!isDatabaseError(error)) {
    return null;
  }

  switch (error.code) {
    case "23505": // unique_violation
      return new ConflictError(
        "A resource with matching unique values already exists.",
      );
    case "23503": // foreign_key_violation
      return new ConflictError(
        "Referenced resource does not exist or has dependent records.",
      );
    case "23514": // check_violation
      return new UnprocessableContentError(
        "Operation violates data integrity constraints.",
      );
    case "40001": // serialization_failure
      return new ConflictError(
        "Transaction conflict due to concurrent modification. Please retry.",
      );
    case "57P01": // admin_shutdown
    case "57P02": // crash_shutdown
    case "57P03": // cannot_connect_now
    case "08000": // connection_exception
    case "08003": // connection_does_not_exist
    case "08006": // connection_failure
      return new ServiceUnavailableError(
        "Database service is temporarily unavailable.",
      );
    default:
      return null;
  }
}

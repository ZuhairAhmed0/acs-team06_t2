import type { ErrorRequestHandler } from "express";

import { AppError } from "../shared/errors/app-error.js";
import { mapDatabaseError } from "../shared/errors/db-error-mapper.js";
import { logger, redactSensitiveData } from "../shared/logging/logger.js";

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req,
  res,
  next,
) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const requestId =
    (res.locals.requestId as string | undefined) ??
    req.id ??
    (res.getHeader("X-Request-ID") as string | undefined) ??
    "unknown";

  // 1. Known application errors
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error(`Server error: ${error.message}`, {
        requestId,
        code: error.code,
        statusCode: error.statusCode,
      });
    } else {
      logger.warn(`Application warning: ${error.message}`, {
        requestId,
        code: error.code,
        statusCode: error.statusCode,
      });
    }

    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        requestId,
      },
    });
    return;
  }

  // 2. Mapped database errors (conservative, non-leaking)
  const mappedDbError = mapDatabaseError(error);
  if (mappedDbError) {
    logger.warn(`Database mapped constraint violation: ${mappedDbError.message}`, {
      requestId,
      code: mappedDbError.code,
      statusCode: mappedDbError.statusCode,
    });

    res.status(mappedDbError.statusCode).json({
      error: {
        code: mappedDbError.code,
        message: mappedDbError.message,
        requestId,
      },
    });
    return;
  }

  // 3. Unexpected / Unhandled exceptions
  // Log full error internally for debugging (with sensitive data redacted)
  logger.error("Unhandled application error", {
    requestId,
    error: redactSensitiveData(error),
  });

  // Safe client response: never leak stack traces, SQL, or internal details
  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
      requestId,
    },
  });
};

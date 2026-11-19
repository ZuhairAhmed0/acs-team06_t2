import { randomBytes, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

import { env } from "../config/env.js";
import { ForbiddenError } from "../shared/errors/app-error.js";

/**
 * Generates a cryptographically secure random token for CSRF protection.
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Performs a timing-safe string comparison to prevent timing attacks.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  if (bufA.length !== bufB.length) {
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Reusable CSRF Protection Middleware using Synchronizer Tokens bound to Server-Side Sessions.
 *
 * Requirements:
 * 1. Safe methods (GET, HEAD, OPTIONS) pass through.
 * 2. Unsafe methods (POST, PUT, PATCH, DELETE) require a matching X-CSRF-Token header.
 * 3. Timing-safe token comparison.
 * 4. Origin header validation against allowed CORS_ORIGIN if present.
 * 5. CSRF tokens are never logged.
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_HTTP_METHODS.has(req.method)) {
    next();
    return;
  }

  // 1. Browser Origin Validation
  const origin = req.headers.origin;
  const host = req.headers.host;
  const isSameOrigin =
    origin &&
    host &&
    (origin === `https://${host}` ||
      origin === `http://${host}` ||
      origin.replace(/^https?:\/\//, "") === host);

  if (origin && !isSameOrigin && env.CORS_ORIGIN && origin !== env.CORS_ORIGIN) {
    next(new ForbiddenError("Cross-origin request not permitted."));
    return;
  }

  // 2. Session Presence Check
  if (!req.session) {
    next(new ForbiddenError("Session required for CSRF validation."));
    return;
  }

  // 3. Token Verification
  const headerToken = req.headers["x-csrf-token"];
  const sessionToken = req.session.csrfToken;

  if (
    typeof headerToken !== "string" ||
    !headerToken ||
    typeof sessionToken !== "string" ||
    !sessionToken ||
    !timingSafeEqualString(headerToken, sessionToken)
  ) {
    next(new ForbiddenError("Invalid or missing CSRF token."));
    return;
  }

  next();
};

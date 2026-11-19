import { rateLimit } from "express-rate-limit";

import { TooManyRequestsError } from "../shared/errors/app-error.js";

/**
 * Strict IP-based rate limiting for authentication endpoints (login & registration).
 *
 * Guarantees:
 * - 20 requests per 15 minutes per IP address.
 * - Keyed purely on client IP; never stores passwords, phone numbers, or credentials.
 * - Standard headers: RateLimit-* returned to client.
 * - Returns a consistent 429 TOO_MANY_REQUESTS error.
 * - In-memory store suitable for single-instance monolith deployment in the MVP.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20, // 20 requests per window
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(
      new TooManyRequestsError(
        "Too many authentication attempts. Please try again later.",
      ),
    );
  },
});

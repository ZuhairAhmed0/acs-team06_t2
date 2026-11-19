import type { NextFunction, Request, RequestHandler, Response } from "express";

import { authService } from "../modules/auth/auth.service.js";
import {
  ServiceUnavailableError,
  UnauthorizedError,
} from "../shared/errors/app-error.js";

/**
 * Reusable Session Authentication Middleware.
 *
 * Enforces:
 * 1. Checks that an active server-side session exists and contains a valid userId.
 * 2. Loads the user fresh from PostgreSQL (to enforce immediate revocation on status change).
 * 3. Rejects INACTIVE and BLOCKED users.
 * 4. Attaches a typed `req.user` context.
 * 5. Fails closed with 503 SERVICE_UNAVAILABLE on session store/database connectivity errors.
 * 6. Never parses Bearer tokens, Authorization headers, or JWTs.
 */
export const authenticate: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.session?.userId;

    if (!userId) {
      next(new UnauthorizedError("Authentication required."));
      return;
    }

    const user = await authService.getUserById(userId);

    if (!user) {
      // User no longer exists in PostgreSQL
      if (req.session) {
        req.session.destroy(() => {});
      }
      next(new UnauthorizedError("Authentication required."));
      return;
    }

    if (user.status !== "ACTIVE") {
      // User account has been deactivated or blocked
      if (req.session) {
        req.session.destroy(() => {});
      }
      next(new UnauthorizedError("Account is inactive or blocked."));
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    // Fail closed: database or session-store errors must never permit access
    next(
      new ServiceUnavailableError(
        "Authentication service is temporarily unavailable.",
      ),
    );
  }
};

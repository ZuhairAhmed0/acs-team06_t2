import { and, eq } from "drizzle-orm";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import { db } from "../db/client.js";
import { stationMembers } from "../db/schema/stations.js";
import {
  BadRequestError,
  ForbiddenError,
  UnauthorizedError,
} from "../shared/errors/app-error.js";

export type AllowedStationRole = "OWNER" | "ATTENDANT";

/**
 * System-role authorization helper.
 * Enforces that only users with the specified systemRole (e.g. "ADMIN") can access the endpoint.
 */
export function requireSystemRole(requiredRole: "ADMIN" | "USER"): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError("Authentication required."));
      return;
    }

    if (req.user.systemRole !== requiredRole) {
      next(
        new ForbiddenError(
          "Access denied. Administrative privileges are required.",
        ),
      );
      return;
    }

    next();
  };
}

/**
 * Station-role authorization helper.
 *
 * Guarantees:
 * 1. ADMIN users have platform-wide administrative authority across all stations.
 * 2. Non-admin users must have an ACTIVE station_members record for the target stationId.
 * 3. The member's role at that specific station must match one of the allowedRoles (OWNER or ATTENDANT).
 * 4. A user can have different roles at different stations.
 * 5. Never trusts client-supplied station roles.
 */
export function requireStationRole(
  allowedRoles: AllowedStationRole[],
  stationIdParam = "stationId",
): RequestHandler {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user) {
        next(new UnauthorizedError("Authentication required."));
        return;
      }

      // Platform admins have universal operational access
      if (req.user.systemRole === "ADMIN") {
        next();
        return;
      }

      const stationId = req.params[stationIdParam];
      if (!stationId) {
        next(new BadRequestError(`Missing route parameter: ${stationIdParam}`));
        return;
      }

      // Query active membership for this specific station in PostgreSQL
      const [membership] = await db
        .select({
          stationId: stationMembers.stationId,
          role: stationMembers.role,
          status: stationMembers.status,
        })
        .from(stationMembers)
        .where(
          and(
            eq(stationMembers.stationId, stationId),
            eq(stationMembers.userId, req.user.id),
            eq(stationMembers.status, "ACTIVE"),
          ),
        )
        .limit(1);

      if (!membership || !allowedRoles.includes(membership.role as AllowedStationRole)) {
        next(
          new ForbiddenError(
            "Access denied. You do not have the required station permissions for this station.",
          ),
        );
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

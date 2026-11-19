import { and, eq, sql } from "drizzle-orm";

import { db } from "../../db/client.js";
import { authSessions } from "../../db/schema/auth-sessions.js";
import { stationMembers, stations } from "../../db/schema/stations.js";
import { users } from "../../db/schema/users.js";
import {
  ConflictError,
  UnauthorizedError,
} from "../../shared/errors/app-error.js";
import type { RegisterInput } from "./auth.schemas.js";
import type { AuthenticatedUser, UserResponseData } from "./auth.types.js";
import { hashPassword, verifyPassword } from "./password.js";

export class AuthService {
  /**
   * Registers a new public USER account.
   *
   * Security Guarantees:
   * - System role is hardcoded to "USER" (never accepts ADMIN).
   * - Password is encrypted with bcrypt (12 rounds).
   * - Never returns passwordHash.
   */
  public async registerUser(
    input: RegisterInput,
  ): Promise<UserResponseData> {
    const passwordHash = await hashPassword(input.password);

    try {
      const [newUser] = await db
        .insert(users)
        .values({
          fullName: input.fullName,
          phone: input.phone,
          passwordHash,
          systemRole: "USER",
          status: "ACTIVE",
        })
        .returning({
          id: users.id,
          fullName: users.fullName,
          phone: users.phone,
          systemRole: users.systemRole,
          status: users.status,
        });

      return newUser;
    } catch (err: any) {
      if (err?.code === "23505") {
        throw new ConflictError(
          "An account with this phone number already exists.",
        );
      }
      throw err;
    }
  }

  /**
   * Verifies login credentials and checks user active status.
   *
   * Security Guarantees:
   * - Generic error message on invalid phone or password to prevent user enumeration.
   * - Rejects INACTIVE and BLOCKED accounts.
   */
  public async verifyCredentials(
    phone: string,
    plainPassword: string,
  ): Promise<AuthenticatedUser> {
    const [user] = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        phone: users.phone,
        passwordHash: users.passwordHash,
        systemRole: users.systemRole,
        status: users.status,
      })
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1);

    if (!user) {
      throw new UnauthorizedError("Invalid phone or password.");
    }

    const isMatch = await verifyPassword(plainPassword, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedError("Invalid phone or password.");
    }

    if (user.status === "BLOCKED") {
      throw new UnauthorizedError("Account is blocked. Please contact support.");
    }

    if (user.status !== "ACTIVE") {
      throw new UnauthorizedError("Account is inactive.");
    }

    return {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      systemRole: user.systemRole,
      status: user.status,
    };
  }

  /**
   * Destroys all sessions in the database belonging to a specific user.
   * Parameterized query matches the session JSON's top-level `userId` field.
   */
  public async revokeAllUserSessions(userId: string): Promise<void> {
    await db
      .delete(authSessions)
      .where(sql`(${authSessions.sess}->>'userId') = ${userId}`);
  }

  /**
   * Retrieves user details by ID from PostgreSQL.
   */
  public async getUserById(userId: string): Promise<AuthenticatedUser | null> {
    const [user] = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        phone: users.phone,
        systemRole: users.systemRole,
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user ?? null;
  }

  /**
   * Retrieves active station memberships for the user.
   */
  public async getUserMemberships(userId: string) {
    return db
      .select({
        stationId: stationMembers.stationId,
        station_id: stationMembers.stationId,
        stationName: stations.name,
        station_name: stations.name,
        role: stationMembers.role,
        membership_role: stationMembers.role,
        status: stationMembers.status,
      })
      .from(stationMembers)
      .innerJoin(stations, eq(stations.id, stationMembers.stationId))
      .where(
        and(
          eq(stationMembers.userId, userId),
          eq(stationMembers.status, "ACTIVE"),
        ),
      );
  }
}

export const authService = new AuthService();

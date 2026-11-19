import { asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../db/client.js";
import { financialAccounts } from "../../db/schema/financial-accounts.js";
import type { DatabaseTransaction, TransactionContext } from "../../db/transaction.js";
import { NotFoundError } from "../../shared/errors/app-error.js";

export class FinancialAccountService {
  /**
   * Ensures the single platform-wide PLATFORM_CASH account exists.
   * Safe to call concurrently due to unique constraint.
   */
  async ensurePlatformCashAccount(tx: TransactionContext = db) {
    const existing = await tx
      .select()
      .from(financialAccounts)
      .where(eq(financialAccounts.accountType, "PLATFORM_CASH"))
      .limit(1);

    if (existing.length > 0) {
      return existing[0]!;
    }

    try {
      const inserted = await tx
        .insert(financialAccounts)
        .values({
          accountType: "PLATFORM_CASH",
          userId: null,
          stationId: null,
        })
        .returning();

      return inserted[0]!;
    } catch {
      // If concurrent insert occurred, re-query
      const reQuery = await tx
        .select()
        .from(financialAccounts)
        .where(eq(financialAccounts.accountType, "PLATFORM_CASH"))
        .limit(1);

      if (reQuery.length > 0) {
        return reQuery[0]!;
      }
      throw new Error("Failed to ensure PLATFORM_CASH account");
    }
  }

  /**
   * Gets or lazily creates a USER_AVAILABLE account for the given user.
   */
  async getOrCreateUserAvailableAccount(userId: string, tx: TransactionContext = db) {
    const existing = await tx
      .select()
      .from(financialAccounts)
      .where(
        sql`${financialAccounts.accountType} = 'USER_AVAILABLE' AND ${financialAccounts.userId} = ${userId}`,
      )
      .limit(1);

    if (existing.length > 0) {
      return existing[0]!;
    }

    try {
      const inserted = await tx
        .insert(financialAccounts)
        .values({
          accountType: "USER_AVAILABLE",
          userId,
          stationId: null,
        })
        .returning();

      return inserted[0]!;
    } catch {
      const reQuery = await tx
        .select()
        .from(financialAccounts)
        .where(
          sql`${financialAccounts.accountType} = 'USER_AVAILABLE' AND ${financialAccounts.userId} = ${userId}`,
        )
        .limit(1);

      if (reQuery.length > 0) {
        return reQuery[0]!;
      }
      throw new Error(`Failed to get or create USER_AVAILABLE account for user ${userId}`);
    }
  }

  /**
   * Gets or lazily creates a USER_ALLOCATED account for a (user, station) pair.
   */
  async getOrCreateUserAllocatedAccount(
    userId: string,
    stationId: string,
    tx: TransactionContext = db,
  ) {
    const existing = await tx
      .select()
      .from(financialAccounts)
      .where(
        sql`${financialAccounts.accountType} = 'USER_ALLOCATED' AND ${financialAccounts.userId} = ${userId} AND ${financialAccounts.stationId} = ${stationId}`,
      )
      .limit(1);

    if (existing.length > 0) {
      return existing[0]!;
    }

    try {
      const inserted = await tx
        .insert(financialAccounts)
        .values({
          accountType: "USER_ALLOCATED",
          userId,
          stationId,
        })
        .returning();

      return inserted[0]!;
    } catch {
      const reQuery = await tx
        .select()
        .from(financialAccounts)
        .where(
          sql`${financialAccounts.accountType} = 'USER_ALLOCATED' AND ${financialAccounts.userId} = ${userId} AND ${financialAccounts.stationId} = ${stationId}`,
        )
        .limit(1);

      if (reQuery.length > 0) {
        return reQuery[0]!;
      }
      throw new Error(
        `Failed to get or create USER_ALLOCATED account for user ${userId} and station ${stationId}`,
      );
    }
  }

  /**
   * Gets or lazily creates a STATION_PAYABLE account for a station.
   */
  async getOrCreateStationPayableAccount(stationId: string, tx: TransactionContext = db) {
    const existing = await tx
      .select()
      .from(financialAccounts)
      .where(
        sql`${financialAccounts.accountType} = 'STATION_PAYABLE' AND ${financialAccounts.stationId} = ${stationId}`,
      )
      .limit(1);

    if (existing.length > 0) {
      return existing[0]!;
    }

    try {
      const inserted = await tx
        .insert(financialAccounts)
        .values({
          accountType: "STATION_PAYABLE",
          userId: null,
          stationId,
        })
        .returning();

      return inserted[0]!;
    } catch {
      const reQuery = await tx
        .select()
        .from(financialAccounts)
        .where(
          sql`${financialAccounts.accountType} = 'STATION_PAYABLE' AND ${financialAccounts.stationId} = ${stationId}`,
        )
        .limit(1);

      if (reQuery.length > 0) {
        return reQuery[0]!;
      }
      throw new Error(`Failed to get or create STATION_PAYABLE account for station ${stationId}`);
    }
  }

  /**
   * Locks affected financial accounts in deterministic order (ascending ID) to prevent deadlocks.
   * Uses PostgreSQL SELECT ... FOR UPDATE.
   */
  async lockAccounts(accountIds: string[], tx: DatabaseTransaction) {
    if (accountIds.length === 0) {
      return [];
    }

    // Deduplicate and sort IDs ascending for deterministic locking order
    const sortedIds = Array.from(new Set(accountIds)).sort();

    const locked = await tx
      .select()
      .from(financialAccounts)
      .where(inArray(financialAccounts.id, sortedIds))
      .orderBy(asc(financialAccounts.id))
      .for("update");

    if (locked.length !== sortedIds.length) {
      const foundIds = new Set(locked.map((a) => a.id));
      const missing = sortedIds.filter((id) => !foundIds.has(id));
      throw new NotFoundError(`Financial account(s) not found for locking: ${missing.join(", ")}`);
    }

    return locked;
  }
}

export const financialAccountService = new FinancialAccountService();

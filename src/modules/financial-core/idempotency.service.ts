import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "../../db/client.js";
import { financialTransactions } from "../../db/schema/financial-transactions.js";
import type { TransactionContext } from "../../db/transaction.js";
import { ConflictError } from "../../shared/errors/app-error.js";

export class IdempotencyService {
  /**
   * Deterministically canonicalizes and hashes any object payload using SHA-256.
   */
  hashPayload(payload: unknown): string {
    const canonicalString = this.canonicalize(payload);
    return crypto.createHash("sha256").update(canonicalString).digest("hex");
  }

  /**
   * Recursively sorts object keys so { a: 1, b: 2 } produces the same string as { b: 2, a: 1 }.
   */
  private canonicalize(val: unknown): string {
    if (val === null || typeof val !== "object") {
      return JSON.stringify(val);
    }

    if (Array.isArray(val)) {
      return `[${val.map((item) => this.canonicalize(item)).join(",")}]`;
    }

    const sortedKeys = Object.keys(val as Record<string, unknown>).sort();
    const parts = sortedKeys.map(
      (k) => `${JSON.stringify(k)}:${this.canonicalize((val as Record<string, unknown>)[k])}`,
    );
    return `{${parts.join(",")}}`;
  }

  /**
   * Verifies an idempotency key against existing financial transactions.
   * If existing matching key is found:
   * - If hash matches: returns the existing transaction.
   * - If hash differs: throws 409 Conflict.
   * If key is unused: returns null.
   */
  async checkIdempotency(
    userId: string,
    idempotencyKey: string,
    requestHash: string,
    tx: TransactionContext = db,
  ) {
    const existing = await tx
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.createdByUserId, userId),
          eq(financialTransactions.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      return null;
    }

    const found = existing[0]!;
    if (found.requestHash && found.requestHash !== requestHash) {
      throw new ConflictError(
        "Idempotency key has already been used with a different request payload.",
      );
    }

    return found;
  }
}

export const idempotencyService = new IdempotencyService();

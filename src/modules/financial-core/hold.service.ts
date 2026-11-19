import { eq } from "drizzle-orm";

import { financialTransactions } from "../../db/schema/financial-transactions.js";
import type { DatabaseTransaction } from "../../db/transaction.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../shared/errors/app-error.js";
import {
  addMonetary,
  compareMonetary,
  isPositiveMonetary,
  subtractMonetary,
} from "../../shared/precision/money.js";

export class HoldService {
  /**
   * Calculates the remaining outstanding hold on a transaction.
   * Outstanding Hold = hold_amount - captured_amount - released_amount.
   */
  getOutstandingHold(transaction: {
    holdAmount: string;
    capturedAmount: string;
    releasedAmount: string;
  }): string {
    const settled = addMonetary(transaction.capturedAmount, transaction.releasedAmount);
    return subtractMonetary(transaction.holdAmount, settled);
  }

  /**
   * Initializes a hold on a financial transaction.
   */
  async createHold(
    tx: DatabaseTransaction,
    params: {
      transactionId: string;
      holdAccountId: string;
      holdAmount: string;
      holdExpiresAt?: Date | null;
    },
  ) {
    if (!isPositiveMonetary(params.holdAmount)) {
      throw new BadRequestError("Hold amount must be strictly positive");
    }

    const [updated] = await tx
      .update(financialTransactions)
      .set({
        holdAccountId: params.holdAccountId,
        holdAmount: params.holdAmount,
        capturedAmount: "0.00",
        releasedAmount: "0.00",
        holdExpiresAt: params.holdExpiresAt ?? null,
        updatedAt: new Date(),
      })
      .where(eq(financialTransactions.id, params.transactionId))
      .returning();

    if (!updated) {
      throw new NotFoundError(`Transaction not found: ${params.transactionId}`);
    }

    return updated;
  }

  /**
   * Captures an amount against an existing active hold.
   */
  async captureHold(
    tx: DatabaseTransaction,
    params: {
      transactionId: string;
      captureAmount: string;
    },
  ) {
    const [txRecord] = await tx
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.id, params.transactionId))
      .for("update");

    if (!txRecord) {
      throw new NotFoundError(`Transaction not found: ${params.transactionId}`);
    }

    if (!txRecord.holdAccountId) {
      throw new BadRequestError(`Transaction ${params.transactionId} does not have an active hold`);
    }

    if (compareMonetary(params.captureAmount, "0.00") <= 0) {
      throw new BadRequestError("Capture amount must be greater than zero");
    }

    const currentSettled = addMonetary(txRecord.capturedAmount, txRecord.releasedAmount);
    const remainingHold = subtractMonetary(txRecord.holdAmount, currentSettled);

    if (compareMonetary(params.captureAmount, remainingHold) > 0) {
      throw new ConflictError(
        `Cannot capture ${params.captureAmount}; exceeds remaining hold of ${remainingHold}`,
      );
    }

    const newCaptured = addMonetary(txRecord.capturedAmount, params.captureAmount);

    const [updated] = await tx
      .update(financialTransactions)
      .set({
        capturedAmount: newCaptured,
        updatedAt: new Date(),
      })
      .where(eq(financialTransactions.id, params.transactionId))
      .returning();

    return updated!;
  }

  /**
   * Releases an unused hold amount back to the account.
   */
  async releaseHold(
    tx: DatabaseTransaction,
    params: {
      transactionId: string;
      releaseAmount?: string; // If omitted, releases all remaining hold
    },
  ) {
    const [txRecord] = await tx
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.id, params.transactionId))
      .for("update");

    if (!txRecord) {
      throw new NotFoundError(`Transaction not found: ${params.transactionId}`);
    }

    if (!txRecord.holdAccountId) {
      // No hold on this transaction
      return txRecord;
    }

    const currentSettled = addMonetary(txRecord.capturedAmount, txRecord.releasedAmount);
    const remainingHold = subtractMonetary(txRecord.holdAmount, currentSettled);

    if (compareMonetary(remainingHold, "0.00") <= 0) {
      // Nothing remaining to release
      return txRecord;
    }

    const toRelease = params.releaseAmount ?? remainingHold;

    if (compareMonetary(toRelease, remainingHold) > 0) {
      throw new ConflictError(
        `Cannot release ${toRelease}; exceeds remaining hold of ${remainingHold}`,
      );
    }

    const newReleased = addMonetary(txRecord.releasedAmount, toRelease);

    const [updated] = await tx
      .update(financialTransactions)
      .set({
        releasedAmount: newReleased,
        updatedAt: new Date(),
      })
      .where(eq(financialTransactions.id, params.transactionId))
      .returning();

    return updated!;
  }
}

export const holdService = new HoldService();

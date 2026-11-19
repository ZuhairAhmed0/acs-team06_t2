import { eq } from "drizzle-orm";

import { financialEntries } from "../../db/schema/financial-entries.js";
import { financialTransactions } from "../../db/schema/financial-transactions.js";
import type { DatabaseTransaction } from "../../db/transaction.js";
import { BadRequestError, UnprocessableContentError } from "../../shared/errors/app-error.js";
import {
  addMonetary,
  compareMonetary,
  isPositiveMonetary,
} from "../../shared/precision/money.js";
import { financialAccountService } from "./financial-account.service.js";
import { financialEventsService } from "./financial-events.service.js";
import type { LedgerEntryInput } from "./financial.types.js";

export class LedgerService {
  /**
   * Posts balanced double-entry ledger rows within an active database transaction.
   *
   * Invariants:
   * 1. Total Debit === Total Credit.
   * 2. Number of entries >= 2.
   * 3. Every entry amount is strictly positive.
   * 4. Accounts are locked in deterministic order before posting.
   */
  async postBalancedMovement(
    tx: DatabaseTransaction,
    params: {
      transactionId: string;
      entries: LedgerEntryInput[];
      actorUserId?: string | null;
      memo?: string;
    },
  ) {
    const { transactionId, entries, actorUserId } = params;

    if (!entries || entries.length < 2) {
      throw new UnprocessableContentError(
        "A balanced ledger movement requires at least two entries.",
      );
    }

    // 1. Lock all affected accounts in ascending order
    const accountIds = entries.map((e) => e.financialAccountId);
    await financialAccountService.lockAccounts(accountIds, tx);

    // 2. Validate entries and sum debits and credits
    let totalDebit = "0.00";
    let totalCredit = "0.00";

    for (const entry of entries) {
      if (!isPositiveMonetary(entry.amount)) {
        throw new BadRequestError(`Ledger entry amount must be strictly positive: ${entry.amount}`);
      }

      if (entry.entryType === "DEBIT") {
        totalDebit = addMonetary(totalDebit, entry.amount);
      } else if (entry.entryType === "CREDIT") {
        totalCredit = addMonetary(totalCredit, entry.amount);
      } else {
        throw new BadRequestError(`Invalid ledger entry type: ${(entry as { entryType: string }).entryType}`);
      }
    }

    // 3. Assert balance: Total Debit === Total Credit
    if (compareMonetary(totalDebit, totalCredit) !== 0) {
      throw new UnprocessableContentError(
        `Unbalanced ledger entries: Total Debit (${totalDebit}) does not match Total Credit (${totalCredit}).`,
      );
    }

    // 4. Insert rows into financial_entries
    const insertedEntries = await tx
      .insert(financialEntries)
      .values(
        entries.map((entry) => ({
          transactionId,
          financialAccountId: entry.financialAccountId,
          entryType: entry.entryType,
          amount: entry.amount,
        })),
      )
      .returning();

    // 5. Record audit event
    await financialEventsService.recordEvent(
      {
        transactionId,
        eventType: "LEDGER_ENTRIES_POSTED",
        actorUserId: actorUserId ?? null,
        metadata: {
          totalAmount: totalDebit,
          entryCount: entries.length,
          memo: params.memo ?? null,
        },
      },
      tx,
    );

    return insertedEntries;
  }
}

export const ledgerService = new LedgerService();

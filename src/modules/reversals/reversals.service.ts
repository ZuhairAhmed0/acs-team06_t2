import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client.js";
import { financialTransactions } from "../../db/schema/financial-transactions.js";
import { withTransaction } from "../../db/transaction.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnprocessableContentError,
} from "../../shared/errors/app-error.js";
import { compareMonetary } from "../../shared/precision/money.js";
import { balanceService } from "../financial-core/balance.service.js";
import { financialAccountService } from "../financial-core/financial-account.service.js";
import { financialEventsService } from "../financial-core/financial-events.service.js";
import { idempotencyService } from "../financial-core/idempotency.service.js";
import { ledgerService } from "../financial-core/ledger.service.js";

export class ReversalsService {
  /**
   * Admin executes a full reversal of a completed financial transaction.
   */
  async createReversal(
    adminUserId: string,
    originalTransactionId: string,
    data: {
      reason: string;
      notes?: string;
      outgoingBankReference?: string;
      incomingBankReference?: string;
    },
    idempotencyKey?: string,
  ) {
    const requestHash = idempotencyKey ? idempotencyService.hashPayload(data) : null;
    if (idempotencyKey && requestHash) {
      const existing = await idempotencyService.checkIdempotency(
        adminUserId,
        idempotencyKey,
        requestHash,
        db,
      );
      if (existing) {
        return existing;
      }
    }

    return withTransaction(async (tx) => {
      // 1. Lock and retrieve original transaction
      const [original] = await tx
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.id, originalTransactionId))
        .for("update");

      if (!original) {
        throw new NotFoundError(`Original transaction not found: ${originalTransactionId}`);
      }

      // 2. Original must be COMPLETED
      if (original.status !== "COMPLETED") {
        throw new ConflictError(
          `Only COMPLETED transactions can be reversed (current status: ${original.status})`,
        );
      }

      // 3. Reversals cannot reverse another reversal
      if (original.transactionType === "REVERSAL") {
        throw new BadRequestError("A reversal cannot reverse another reversal transaction");
      }

      // 4. Maximum one reversal per original transaction
      const [existingReversal] = await tx
        .select()
        .from(financialTransactions)
        .where(
          and(
            eq(financialTransactions.reversalOfTransactionId, original.id),
            eq(financialTransactions.status, "COMPLETED"),
          ),
        )
        .limit(1);

      if (existingReversal) {
        throw new ConflictError(
          `This transaction has already been reversed by reversal transaction ${existingReversal.id}`,
        );
      }

      const reversalAmount = original.amount!;

      // 5. Determine reversal ledger mapping and verify balance prerequisites
      let debitAccountId: string;
      let creditAccountId: string;

      switch (original.transactionType) {
        case "TOP_UP": {
          if (!data.outgoingBankReference) {
            throw new BadRequestError(
              "Top-up reversal requires a verified outgoing refund bank reference",
            );
          }

          const cashAccount = await financialAccountService.ensurePlatformCashAccount(tx);
          const userAvailable = await financialAccountService.getOrCreateUserAvailableAccount(
            original.userId!,
            tx,
          );

          await financialAccountService.lockAccounts([userAvailable.id, cashAccount.id], tx);

          const available = await balanceService.getAvailableBalance(
            userAvailable.id,
            "USER_AVAILABLE",
            tx,
          );

          if (compareMonetary(available, reversalAmount) < 0) {
            throw new UnprocessableContentError(
              `User available balance (${available}) is insufficient to reverse top-up of ${reversalAmount}`,
            );
          }

          debitAccountId = userAvailable.id;
          creditAccountId = cashAccount.id;
          break;
        }

        case "ALLOCATION": {
          const userAllocated = await financialAccountService.getOrCreateUserAllocatedAccount(
            original.userId!,
            original.stationId!,
            tx,
          );
          const userAvailable = await financialAccountService.getOrCreateUserAvailableAccount(
            original.userId!,
            tx,
          );

          await financialAccountService.lockAccounts([userAllocated.id, userAvailable.id], tx);

          const allocatedBalance = await balanceService.getAvailableBalance(
            userAllocated.id,
            "USER_ALLOCATED",
            tx,
          );

          if (compareMonetary(allocatedBalance, reversalAmount) < 0) {
            throw new UnprocessableContentError(
              `User allocated balance (${allocatedBalance}) is insufficient to reverse allocation of ${reversalAmount}`,
            );
          }

          debitAccountId = userAllocated.id;
          creditAccountId = userAvailable.id;
          break;
        }

        case "DEALLOCATION": {
          const userAvailable = await financialAccountService.getOrCreateUserAvailableAccount(
            original.userId!,
            tx,
          );
          const userAllocated = await financialAccountService.getOrCreateUserAllocatedAccount(
            original.userId!,
            original.stationId!,
            tx,
          );

          await financialAccountService.lockAccounts([userAvailable.id, userAllocated.id], tx);

          const available = await balanceService.getAvailableBalance(
            userAvailable.id,
            "USER_AVAILABLE",
            tx,
          );

          if (compareMonetary(available, reversalAmount) < 0) {
            throw new UnprocessableContentError(
              `User available balance (${available}) is insufficient to reverse deallocation of ${reversalAmount}`,
            );
          }

          debitAccountId = userAvailable.id;
          creditAccountId = userAllocated.id;
          break;
        }

        case "TRANSFER": {
          const destAllocated = await financialAccountService.getOrCreateUserAllocatedAccount(
            original.userId!,
            original.destinationStationId!,
            tx,
          );
          const sourceAllocated = await financialAccountService.getOrCreateUserAllocatedAccount(
            original.userId!,
            original.sourceStationId!,
            tx,
          );

          await financialAccountService.lockAccounts([destAllocated.id, sourceAllocated.id], tx);

          const destBalance = await balanceService.getAvailableBalance(
            destAllocated.id,
            "USER_ALLOCATED",
            tx,
          );

          if (compareMonetary(destBalance, reversalAmount) < 0) {
            throw new UnprocessableContentError(
              `Destination station allocated balance (${destBalance}) is insufficient to reverse transfer of ${reversalAmount}`,
            );
          }

          debitAccountId = destAllocated.id;
          creditAccountId = sourceAllocated.id;
          break;
        }

        case "FUEL_PURCHASE": {
          if (!data.incomingBankReference) {
            throw new BadRequestError(
              "Fuel purchase reversal requires a verified incoming bank reference proving station refund arrival",
            );
          }

          const cashAccount = await financialAccountService.ensurePlatformCashAccount(tx);
          const userAllocated = await financialAccountService.getOrCreateUserAllocatedAccount(
            original.userId!,
            original.stationId!,
            tx,
          );

          await financialAccountService.lockAccounts([cashAccount.id, userAllocated.id], tx);

          debitAccountId = cashAccount.id;
          creditAccountId = userAllocated.id;
          break;
        }

        case "WITHDRAWAL": {
          if (!data.incomingBankReference) {
            throw new BadRequestError(
              "Withdrawal reversal requires a verified incoming bank reference proving returned funds arrival",
            );
          }

          const cashAccount = await financialAccountService.ensurePlatformCashAccount(tx);
          const userAvailable = await financialAccountService.getOrCreateUserAvailableAccount(
            original.userId!,
            tx,
          );

          await financialAccountService.lockAccounts([cashAccount.id, userAvailable.id], tx);

          debitAccountId = cashAccount.id;
          creditAccountId = userAvailable.id;
          break;
        }

        case "SETTLEMENT": {
          if (!data.incomingBankReference) {
            throw new BadRequestError(
              "Settlement reversal requires a verified incoming bank reference proving returned funds arrival",
            );
          }

          const cashAccount = await financialAccountService.ensurePlatformCashAccount(tx);
          const stationPayable = await financialAccountService.getOrCreateStationPayableAccount(
            original.stationId!,
            tx,
          );

          await financialAccountService.lockAccounts([cashAccount.id, stationPayable.id], tx);

          debitAccountId = cashAccount.id;
          creditAccountId = stationPayable.id;
          break;
        }

        default:
          throw new BadRequestError(`Unsupported reversal transaction type: ${original.transactionType}`);
      }

      // 6. Create new REVERSAL financial transaction
      const now = new Date();
      const [reversalTransaction] = await tx
        .insert(financialTransactions)
        .values({
          transactionType: "REVERSAL",
          status: "COMPLETED",
          executionStatus: "NOT_REQUIRED",
          requestedAmount: reversalAmount,
          amount: reversalAmount,
          userId: original.userId,
          stationId: original.stationId,
          sourceStationId: original.sourceStationId,
          destinationStationId: original.destinationStationId,
          bankAccountId: original.bankAccountId,
          reversalOfTransactionId: original.id,
          outgoingBankReference: data.outgoingBankReference?.trim() ?? null,
          incomingBankReference: data.incomingBankReference?.trim() ?? null,
          createdByUserId: adminUserId,
          processedByUserId: adminUserId,
          processedAt: now,
          resolutionNote: data.reason,
          idempotencyKey: idempotencyKey ?? null,
          requestHash: requestHash ?? null,
        })
        .returning();

      // 7. Post opposite balanced double-entry ledger rows
      await ledgerService.postBalancedMovement(tx, {
        transactionId: reversalTransaction!.id,
        entries: [
          {
            financialAccountId: debitAccountId,
            entryType: "DEBIT",
            amount: reversalAmount,
          },
          {
            financialAccountId: creditAccountId,
            entryType: "CREDIT",
            amount: reversalAmount,
          },
        ],
        actorUserId: adminUserId,
        memo: `Reversal of transaction ${original.id}: ${data.reason}`,
      });

      // 8. Record audit event
      await financialEventsService.recordEvent(
        {
          transactionId: reversalTransaction!.id,
          eventType: "TRANSACTION_REVERSED",
          newStatus: "COMPLETED",
          newExecutionStatus: "NOT_REQUIRED",
          actorUserId: adminUserId,
          idempotencyKey,
          requestHash,
          metadata: {
            originalTransactionId: original.id,
            originalType: original.transactionType,
            reversalAmount,
            reason: data.reason,
            notes: data.notes ?? null,
            outgoingBankReference: data.outgoingBankReference ?? null,
            incomingBankReference: data.incomingBankReference ?? null,
          },
        },
        tx,
      );

      return reversalTransaction!;
    });
  }

  async getReversals() {
    return db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.transactionType, "REVERSAL"))
      .orderBy(desc(financialTransactions.createdAt))
      .limit(100);
  }
}

export const reversalsService = new ReversalsService();

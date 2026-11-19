import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client.js";
import { bankAccounts } from "../../db/schema/bank-accounts.js";
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

export class WithdrawalsService {
  /**
   * User creates a withdrawal request held against USER_AVAILABLE.
   */
  async createWithdrawalRequest(
    userId: string,
    data: { bankAccountId: string; requestedAmount: string },
    idempotencyKey?: string,
  ) {
    const requestHash = idempotencyKey ? idempotencyService.hashPayload(data) : null;
    if (idempotencyKey && requestHash) {
      const existing = await idempotencyService.checkIdempotency(
        userId,
        idempotencyKey,
        requestHash,
        db,
      );
      if (existing) {
        return existing;
      }
    }

    return withTransaction(async (tx) => {
      // 1. Validate bank account belongs to user and is active
      const [account] = await tx
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, data.bankAccountId),
            eq(bankAccounts.userId, userId),
            eq(bankAccounts.isActive, true),
          ),
        )
        .limit(1);

      if (!account) {
        throw new BadRequestError("Invalid or inactive user bank account");
      }

      // 2. Lock USER_AVAILABLE account
      const userAvailable = await financialAccountService.getOrCreateUserAvailableAccount(
        userId,
        tx,
      );
      await financialAccountService.lockAccounts([userAvailable.id], tx);

      // 3. Verify available balance
      const spendable = await balanceService.getAvailableBalance(
        userAvailable.id,
        "USER_AVAILABLE",
        tx,
      );

      if (compareMonetary(spendable, data.requestedAmount) < 0) {
        throw new UnprocessableContentError(
          `Insufficient spendable available balance (${spendable}) for withdrawal of ${data.requestedAmount}`,
        );
      }

      // 4. Create PENDING withdrawal transaction with full hold
      const [transaction] = await tx
        .insert(financialTransactions)
        .values({
          transactionType: "WITHDRAWAL",
          status: "PENDING",
          executionStatus: "NOT_STARTED",
          requestedAmount: data.requestedAmount,
          amount: null,
          userId,
          bankAccountId: data.bankAccountId,
          createdByUserId: userId,
          holdAccountId: userAvailable.id,
          holdAmount: data.requestedAmount,
          capturedAmount: "0.00",
          releasedAmount: "0.00",
          idempotencyKey: idempotencyKey ?? null,
          requestHash: requestHash ?? null,
        })
        .returning();

      await financialEventsService.recordEvent(
        {
          transactionId: transaction!.id,
          eventType: "WITHDRAWAL_REQUESTED",
          newStatus: "PENDING",
          newExecutionStatus: "NOT_STARTED",
          actorUserId: userId,
          idempotencyKey,
          requestHash,
          metadata: {
            requestedAmount: data.requestedAmount,
            bankAccountId: data.bankAccountId,
          },
        },
        tx,
      );

      return transaction!;
    });
  }

  /**
   * Admin approves starting the outgoing transfer, locking central cash and creating cash commitment.
   */
  async approveWithdrawal(adminUserId: string, transactionId: string) {
    return withTransaction(async (tx) => {
      const [transaction] = await tx
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.id, transactionId))
        .for("update");

      if (!transaction) {
        throw new NotFoundError(`Transaction not found: ${transactionId}`);
      }

      if (transaction.transactionType !== "WITHDRAWAL") {
        throw new BadRequestError("Only WITHDRAWAL transactions can be approved here");
      }

      if (transaction.status !== "PENDING") {
        throw new ConflictError(`Transaction is not pending (status: ${transaction.status})`);
      }

      // Lock PLATFORM_CASH and verify uncommitted cash balance
      const cashAccount = await financialAccountService.ensurePlatformCashAccount(tx);
      await financialAccountService.lockAccounts([cashAccount.id], tx);

      const cashSummary = await balanceService.getPlatformCashSummary(tx);
      if (compareMonetary(cashSummary.availableCash, transaction.requestedAmount) < 0) {
        throw new UnprocessableContentError(
          `Platform central cash (${cashSummary.availableCash} uncommitted) cannot cover withdrawal of ${transaction.requestedAmount}`,
        );
      }

      // Transition to PROCESSING and IN_PROGRESS
      const now = new Date();
      const [updated] = await tx
        .update(financialTransactions)
        .set({
          status: "PROCESSING",
          executionStatus: "IN_PROGRESS",
          executionStartedAt: now,
          processedByUserId: adminUserId,
          updatedAt: now,
        })
        .where(eq(financialTransactions.id, transaction.id))
        .returning();

      await financialEventsService.recordEvent(
        {
          transactionId: transaction.id,
          eventType: "WITHDRAWAL_PROCESSING_STARTED",
          previousStatus: "PENDING",
          newStatus: "PROCESSING",
          previousExecutionStatus: "NOT_STARTED",
          newExecutionStatus: "IN_PROGRESS",
          actorUserId: adminUserId,
          metadata: { requestedAmount: transaction.requestedAmount },
        },
        tx,
      );

      return updated!;
    });
  }

  /**
   * Admin rejects withdrawal request before bank transfer execution.
   */
  async rejectWithdrawal(adminUserId: string, transactionId: string, reason: string) {
    return withTransaction(async (tx) => {
      const [transaction] = await tx
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.id, transactionId))
        .for("update");

      if (!transaction) {
        throw new NotFoundError(`Transaction not found: ${transactionId}`);
      }

      if (transaction.status !== "PENDING") {
        throw new ConflictError(`Cannot reject transaction with status: ${transaction.status}`);
      }

      // Release full user hold
      const [updated] = await tx
        .update(financialTransactions)
        .set({
          capturedAmount: "0.00",
          releasedAmount: transaction.holdAmount,
          status: "REJECTED",
          executionStatus: "NOT_REQUIRED",
          processedByUserId: adminUserId,
          processedAt: new Date(),
          resolutionNote: reason,
          updatedAt: new Date(),
        })
        .where(eq(financialTransactions.id, transaction.id))
        .returning();

      await financialEventsService.recordEvent(
        {
          transactionId: transaction.id,
          eventType: "WITHDRAWAL_REJECTED",
          previousStatus: "PENDING",
          newStatus: "REJECTED",
          previousExecutionStatus: "NOT_STARTED",
          newExecutionStatus: "NOT_REQUIRED",
          actorUserId: adminUserId,
          metadata: { reason, releasedAmount: transaction.holdAmount },
        },
        tx,
      );

      return updated!;
    });
  }

  /**
   * Admin confirms external bank transfer succeeded.
   */
  async confirmWithdrawalSuccess(
    adminUserId: string,
    transactionId: string,
    data: { actualAmount: string; outgoingBankReference: string },
  ) {
    return withTransaction(async (tx) => {
      const [transaction] = await tx
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.id, transactionId))
        .for("update");

      if (!transaction) {
        throw new NotFoundError(`Transaction not found: ${transactionId}`);
      }

      if (transaction.status !== "PROCESSING") {
        throw new ConflictError(`Transaction is not processing (status: ${transaction.status})`);
      }

      if (data.actualAmount !== transaction.requestedAmount) {
        throw new BadRequestError("Actual amount must match requested amount in MVP");
      }

      // Ensure reference is unique
      const [existingRef] = await tx
        .select()
        .from(financialTransactions)
        .where(
          and(
            eq(financialTransactions.outgoingBankReference, data.outgoingBankReference.trim()),
            sql`${financialTransactions.id} <> ${transaction.id}`,
            sql`${financialTransactions.status} = 'COMPLETED'`,
          ),
        )
        .limit(1);

      if (existingRef) {
        throw new ConflictError("Outgoing bank reference has already been used");
      }

      // Lock accounts: USER_AVAILABLE and PLATFORM_CASH
      const cashAccount = await financialAccountService.ensurePlatformCashAccount(tx);
      const userAvailable = await financialAccountService.getOrCreateUserAvailableAccount(
        transaction.userId!,
        tx,
      );

      await financialAccountService.lockAccounts([userAvailable.id, cashAccount.id], tx);

      // Post balanced ledger movement: Debit USER_AVAILABLE, Credit PLATFORM_CASH
      await ledgerService.postBalancedMovement(tx, {
        transactionId: transaction.id,
        entries: [
          {
            financialAccountId: userAvailable.id,
            entryType: "DEBIT",
            amount: data.actualAmount,
          },
          {
            financialAccountId: cashAccount.id,
            entryType: "CREDIT",
            amount: data.actualAmount,
          },
        ],
        actorUserId: adminUserId,
        memo: `Withdrawal transfer confirmed: ref ${data.outgoingBankReference}`,
      });

      // Capture full hold and complete
      const [updated] = await tx
        .update(financialTransactions)
        .set({
          amount: data.actualAmount,
          capturedAmount: data.actualAmount,
          releasedAmount: "0.00",
          outgoingBankReference: data.outgoingBankReference.trim(),
          status: "COMPLETED",
          executionStatus: "SUCCEEDED",
          processedByUserId: adminUserId,
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(financialTransactions.id, transaction.id))
        .returning();

      await financialEventsService.recordEvent(
        {
          transactionId: transaction.id,
          eventType: "WITHDRAWAL_CONFIRMED_SUCCESS",
          previousStatus: "PROCESSING",
          newStatus: "COMPLETED",
          previousExecutionStatus: transaction.executionStatus,
          newExecutionStatus: "SUCCEEDED",
          actorUserId: adminUserId,
          metadata: {
            actualAmount: data.actualAmount,
            outgoingBankReference: data.outgoingBankReference.trim(),
          },
        },
        tx,
      );

      return updated!;
    });
  }

  /**
   * Admin confirms external bank transfer failed (confirmed not executed).
   */
  async confirmWithdrawalFailure(adminUserId: string, transactionId: string, reason: string) {
    return withTransaction(async (tx) => {
      const [transaction] = await tx
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.id, transactionId))
        .for("update");

      if (!transaction) {
        throw new NotFoundError(`Transaction not found: ${transactionId}`);
      }

      // Release user hold
      const [updated] = await tx
        .update(financialTransactions)
        .set({
          capturedAmount: "0.00",
          releasedAmount: transaction.holdAmount,
          status: "FAILED",
          executionStatus: "FAILED",
          processedByUserId: adminUserId,
          processedAt: new Date(),
          resolutionNote: reason,
          updatedAt: new Date(),
        })
        .where(eq(financialTransactions.id, transaction.id))
        .returning();

      await financialEventsService.recordEvent(
        {
          transactionId: transaction.id,
          eventType: "WITHDRAWAL_CONFIRMED_FAILURE",
          previousStatus: transaction.status,
          newStatus: "FAILED",
          previousExecutionStatus: transaction.executionStatus,
          newExecutionStatus: "FAILED",
          actorUserId: adminUserId,
          metadata: { reason, releasedAmount: transaction.holdAmount },
        },
        tx,
      );

      return updated!;
    });
  }

  /**
   * Marks withdrawal as UNKNOWN outcome, retaining hold and platform commitment.
   */
  async markWithdrawalUnknown(adminUserId: string, transactionId: string, reason: string) {
    return withTransaction(async (tx) => {
      const [transaction] = await tx
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.id, transactionId))
        .for("update");

      if (!transaction) {
        throw new NotFoundError(`Transaction not found: ${transactionId}`);
      }

      const [updated] = await tx
        .update(financialTransactions)
        .set({
          status: "PROCESSING",
          executionStatus: "UNKNOWN",
          resolutionNote: reason,
          updatedAt: new Date(),
        })
        .where(eq(financialTransactions.id, transaction.id))
        .returning();

      await financialEventsService.recordEvent(
        {
          transactionId: transaction.id,
          eventType: "WITHDRAWAL_OUTCOME_UNKNOWN",
          previousExecutionStatus: transaction.executionStatus,
          newExecutionStatus: "UNKNOWN",
          actorUserId: adminUserId,
          metadata: { reason },
        },
        tx,
      );

      return updated!;
    });
  }

  async getUserWithdrawals(userId: string) {
    return db
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.userId, userId),
          eq(financialTransactions.transactionType, "WITHDRAWAL"),
        ),
      )
      .orderBy(desc(financialTransactions.createdAt));
  }

  async getAdminWithdrawals() {
    return db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.transactionType, "WITHDRAWAL"))
      .orderBy(desc(financialTransactions.createdAt))
      .limit(100);
  }
}

export const withdrawalsService = new WithdrawalsService();

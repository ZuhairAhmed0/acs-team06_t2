import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "../../db/client.js";
import { bankAccounts } from "../../db/schema/bank-accounts.js";
import { financialAccounts } from "../../db/schema/financial-accounts.js";
import { financialTransactions } from "../../db/schema/financial-transactions.js";
import { stations } from "../../db/schema/stations.js";
import { withTransaction, type DatabaseTransaction } from "../../db/transaction.js";
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

export class WalletService {
  /**
   * Retrieves user wallet summary.
   */
  async getWalletSummary(userId: string) {
    return balanceService.getUserWalletSummary(userId);
  }

  /**
   * Retrieves paginated transaction history for the user.
   */
  async getTransactionHistory(
    userId: string,
    filters: {
      page: number;
      limit: number;
      type?: string;
      status?: string;
      fromDate?: string;
      toDate?: string;
    },
  ) {
    const conditions = [eq(financialTransactions.userId, userId)];

    if (filters.type) {
      conditions.push(
        eq(financialTransactions.transactionType, filters.type as any),
      );
    }
    if (filters.status) {
      conditions.push(
        eq(financialTransactions.status, filters.status as any),
      );
    }
    if (filters.fromDate) {
      conditions.push(gte(financialTransactions.createdAt, new Date(filters.fromDate)));
    }
    if (filters.toDate) {
      conditions.push(lte(financialTransactions.createdAt, new Date(filters.toDate)));
    }

    const whereClause = and(...conditions);
    const offset = (filters.page - 1) * filters.limit;

    const [totalCountResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(financialTransactions)
      .where(whereClause);

    const total = totalCountResult?.count ?? 0;

    const items = await db
      .select()
      .from(financialTransactions)
      .where(whereClause)
      .orderBy(desc(financialTransactions.createdAt))
      .limit(filters.limit)
      .offset(offset);

    return {
      items,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.ceil(total / filters.limit),
      },
    };
  }

  /**
   * Creates a PENDING top-up request.
   */
  async createTopUpRequest(
    userId: string,
    data: {
      requestedAmount: string;
      bankAccountId: string;
      submittedBankReference: string;
    },
    idempotencyKey?: string,
  ) {
    // 1. Verify bank account belongs to user and is active
    const [bankAccount] = await db
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

    if (!bankAccount) {
      throw new BadRequestError("Invalid or inactive user bank account");
    }

    // 2. Reject duplicate bank reference for this bank account
    const [existingReference] = await db
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.bankAccountId, data.bankAccountId),
          eq(financialTransactions.submittedBankReference, data.submittedBankReference.trim()),
          sql`${financialTransactions.status} NOT IN ('REJECTED', 'FAILED', 'CANCELLED')`,
        ),
      )
      .limit(1);

    if (existingReference) {
      throw new ConflictError(
        "This bank reference has already been submitted for this bank account",
      );
    }

    // 3. Handle idempotency
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

    // 4. Create PENDING transaction
    return withTransaction(async (tx) => {
      const [transaction] = await tx
        .insert(financialTransactions)
        .values({
          transactionType: "TOP_UP",
          status: "PENDING",
          executionStatus: "NOT_STARTED",
          requestedAmount: data.requestedAmount,
          userId,
          bankAccountId: data.bankAccountId,
          submittedBankReference: data.submittedBankReference.trim(),
          createdByUserId: userId,
          idempotencyKey: idempotencyKey ?? null,
          requestHash: requestHash ?? null,
        })
        .returning();

      await financialEventsService.recordEvent(
        {
          transactionId: transaction!.id,
          eventType: "TOP_UP_REQUESTED",
          newStatus: "PENDING",
          newExecutionStatus: "NOT_STARTED",
          actorUserId: userId,
          idempotencyKey,
          requestHash,
          metadata: {
            requestedAmount: data.requestedAmount,
            bankAccountId: data.bankAccountId,
            submittedBankReference: data.submittedBankReference.trim(),
          },
        },
        tx,
      );

      return transaction!;
    });
  }

  /**
   * Admin approves top-up after verifying bank transfer arrival.
   */
  async approveTopUp(
    adminUserId: string,
    transactionId: string,
    data: { actualReceivedAmount?: string; resolutionNote?: string },
  ) {
    return withTransaction(async (tx) => {
      // 1. Lock and retrieve transaction
      const [transaction] = await tx
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.id, transactionId))
        .for("update");

      if (!transaction) {
        throw new NotFoundError(`Transaction not found: ${transactionId}`);
      }

      if (transaction.transactionType !== "TOP_UP") {
        throw new BadRequestError("Only TOP_UP transactions can be approved via this endpoint");
      }

      if (transaction.status !== "PENDING") {
        throw new ConflictError(`Transaction is not pending (current status: ${transaction.status})`);
      }

      const actualAmount = data.actualReceivedAmount ?? transaction.requestedAmount;

      // 2. Provision and lock financial accounts
      const cashAccount = await financialAccountService.ensurePlatformCashAccount(tx);
      const userAvailable = await financialAccountService.getOrCreateUserAvailableAccount(
        transaction.userId!,
        tx,
      );

      // 3. Post balanced double-entry ledger rows: Debit PLATFORM_CASH, Credit USER_AVAILABLE
      await ledgerService.postBalancedMovement(tx, {
        transactionId: transaction.id,
        entries: [
          {
            financialAccountId: cashAccount.id,
            entryType: "DEBIT",
            amount: actualAmount,
          },
          {
            financialAccountId: userAvailable.id,
            entryType: "CREDIT",
            amount: actualAmount,
          },
        ],
        actorUserId: adminUserId,
        memo: "Top-up bank arrival verified",
      });

      // 4. Update transaction status
      const [updated] = await tx
        .update(financialTransactions)
        .set({
          amount: actualAmount,
          status: "COMPLETED",
          executionStatus: "SUCCEEDED",
          processedByUserId: adminUserId,
          processedAt: new Date(),
          resolutionNote: data.resolutionNote ?? null,
          updatedAt: new Date(),
        })
        .where(eq(financialTransactions.id, transaction.id))
        .returning();

      // 5. Audit event
      await financialEventsService.recordEvent(
        {
          transactionId: transaction.id,
          eventType: "TOP_UP_APPROVED",
          previousStatus: "PENDING",
          newStatus: "COMPLETED",
          previousExecutionStatus: "NOT_STARTED",
          newExecutionStatus: "SUCCEEDED",
          actorUserId: adminUserId,
          metadata: {
            actualAmount,
            requestedAmount: transaction.requestedAmount,
            resolutionNote: data.resolutionNote ?? null,
          },
        },
        tx,
      );

      return updated!;
    });
  }

  /**
   * Admin rejects unverified top-up request.
   */
  async rejectTopUp(adminUserId: string, transactionId: string, reason: string) {
    return withTransaction(async (tx) => {
      const [transaction] = await tx
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.id, transactionId))
        .for("update");

      if (!transaction) {
        throw new NotFoundError(`Transaction not found: ${transactionId}`);
      }

      if (transaction.transactionType !== "TOP_UP") {
        throw new BadRequestError("Only TOP_UP transactions can be rejected via this endpoint");
      }

      if (transaction.status !== "PENDING") {
        throw new ConflictError(`Transaction is not pending (current status: ${transaction.status})`);
      }

      const [updated] = await tx
        .update(financialTransactions)
        .set({
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
          eventType: "TOP_UP_REJECTED",
          previousStatus: "PENDING",
          newStatus: "REJECTED",
          previousExecutionStatus: "NOT_STARTED",
          newExecutionStatus: "NOT_REQUIRED",
          actorUserId: adminUserId,
          metadata: { reason },
        },
        tx,
      );

      return updated!;
    });
  }

  /**
   * Allocates available balance to a station.
   */
  async createAllocation(
    userId: string,
    data: { stationId: string; amount: string },
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
      // 1. Verify station is active
      const [station] = await tx
        .select()
        .from(stations)
        .where(and(eq(stations.id, data.stationId), eq(stations.status, "ACTIVE")))
        .limit(1);

      if (!station) {
        throw new BadRequestError("Station not found or inactive");
      }

      // 2. Ensure accounts exist and lock in deterministic order
      const userAvailable = await financialAccountService.getOrCreateUserAvailableAccount(
        userId,
        tx,
      );
      const userAllocated = await financialAccountService.getOrCreateUserAllocatedAccount(
        userId,
        data.stationId,
        tx,
      );

      await financialAccountService.lockAccounts([userAvailable.id, userAllocated.id], tx);

      // 3. Verify user spendable balance
      const spendable = await balanceService.getAvailableBalance(
        userAvailable.id,
        "USER_AVAILABLE",
        tx,
      );

      if (compareMonetary(spendable, data.amount) < 0) {
        throw new UnprocessableContentError(
          `Insufficient spendable available balance (${spendable}) for allocation of ${data.amount}`,
        );
      }

      // 4. Create transaction record
      const [transaction] = await tx
        .insert(financialTransactions)
        .values({
          transactionType: "ALLOCATION",
          status: "COMPLETED",
          executionStatus: "NOT_REQUIRED",
          requestedAmount: data.amount,
          amount: data.amount,
          userId,
          stationId: data.stationId,
          createdByUserId: userId,
          idempotencyKey: idempotencyKey ?? null,
          requestHash: requestHash ?? null,
          processedAt: new Date(),
        })
        .returning();

      // 5. Post balanced ledger entries: Debit USER_AVAILABLE, Credit USER_ALLOCATED
      await ledgerService.postBalancedMovement(tx, {
        transactionId: transaction!.id,
        entries: [
          {
            financialAccountId: userAvailable.id,
            entryType: "DEBIT",
            amount: data.amount,
          },
          {
            financialAccountId: userAllocated.id,
            entryType: "CREDIT",
            amount: data.amount,
          },
        ],
        actorUserId: userId,
        memo: `Allocated to station ${station.name}`,
      });

      await financialEventsService.recordEvent(
        {
          transactionId: transaction!.id,
          eventType: "ALLOCATION_COMPLETED",
          newStatus: "COMPLETED",
          newExecutionStatus: "NOT_REQUIRED",
          actorUserId: userId,
          idempotencyKey,
          requestHash,
          metadata: { amount: data.amount, stationId: data.stationId },
        },
        tx,
      );

      return transaction!;
    });
  }

  /**
   * Deallocates balance from a station back to available wallet.
   */
  async createDeallocation(
    userId: string,
    data: { stationId: string; amount: string },
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
      // 1. Ensure accounts exist and lock in deterministic order
      const userAllocated = await financialAccountService.getOrCreateUserAllocatedAccount(
        userId,
        data.stationId,
        tx,
      );
      const userAvailable = await financialAccountService.getOrCreateUserAvailableAccount(
        userId,
        tx,
      );

      await financialAccountService.lockAccounts([userAllocated.id, userAvailable.id], tx);

      // 2. Verify allocated spendable balance after active holds
      const spendableAllocated = await balanceService.getAvailableBalance(
        userAllocated.id,
        "USER_ALLOCATED",
        tx,
      );

      if (compareMonetary(spendableAllocated, data.amount) < 0) {
        throw new UnprocessableContentError(
          `Insufficient spendable allocated balance (${spendableAllocated}) for deallocation of ${data.amount}`,
        );
      }

      // 3. Create transaction record
      const [transaction] = await tx
        .insert(financialTransactions)
        .values({
          transactionType: "DEALLOCATION",
          status: "COMPLETED",
          executionStatus: "NOT_REQUIRED",
          requestedAmount: data.amount,
          amount: data.amount,
          userId,
          stationId: data.stationId,
          createdByUserId: userId,
          idempotencyKey: idempotencyKey ?? null,
          requestHash: requestHash ?? null,
          processedAt: new Date(),
        })
        .returning();

      // 4. Post balanced ledger entries: Debit USER_ALLOCATED, Credit USER_AVAILABLE
      await ledgerService.postBalancedMovement(tx, {
        transactionId: transaction!.id,
        entries: [
          {
            financialAccountId: userAllocated.id,
            entryType: "DEBIT",
            amount: data.amount,
          },
          {
            financialAccountId: userAvailable.id,
            entryType: "CREDIT",
            amount: data.amount,
          },
        ],
        actorUserId: userId,
        memo: `Deallocated from station ${data.stationId}`,
      });

      await financialEventsService.recordEvent(
        {
          transactionId: transaction!.id,
          eventType: "DEALLOCATION_COMPLETED",
          newStatus: "COMPLETED",
          newExecutionStatus: "NOT_REQUIRED",
          actorUserId: userId,
          idempotencyKey,
          requestHash,
          metadata: { amount: data.amount, stationId: data.stationId },
        },
        tx,
      );

      return transaction!;
    });
  }

  /**
   * Transfers allocation from source station to destination station without platform fee.
   */
  async createTransfer(
    userId: string,
    data: {
      sourceStationId: string;
      destinationStationId: string;
      amount: string;
    },
    idempotencyKey?: string,
  ) {
    if (data.sourceStationId === data.destinationStationId) {
      throw new BadRequestError("Source and destination stations must be different");
    }

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
      // 1. Verify both stations are active
      const activeStations = await tx
        .select()
        .from(stations)
        .where(
          and(
            inArray(stations.id, [data.sourceStationId, data.destinationStationId]),
            eq(stations.status, "ACTIVE"),
          ),
        );

      if (activeStations.length !== 2) {
        throw new BadRequestError("One or both stations are not found or inactive");
      }

      // 2. Ensure accounts exist and lock in deterministic order
      const sourceAllocated = await financialAccountService.getOrCreateUserAllocatedAccount(
        userId,
        data.sourceStationId,
        tx,
      );
      const destAllocated = await financialAccountService.getOrCreateUserAllocatedAccount(
        userId,
        data.destinationStationId,
        tx,
      );

      await financialAccountService.lockAccounts([sourceAllocated.id, destAllocated.id], tx);

      // 3. Verify source spendable balance after active holds
      const sourceSpendable = await balanceService.getAvailableBalance(
        sourceAllocated.id,
        "USER_ALLOCATED",
        tx,
      );

      if (compareMonetary(sourceSpendable, data.amount) < 0) {
        throw new UnprocessableContentError(
          `Insufficient spendable balance (${sourceSpendable}) at source station for transfer of ${data.amount}`,
        );
      }

      // 4. Create transaction record
      const [transaction] = await tx
        .insert(financialTransactions)
        .values({
          transactionType: "TRANSFER",
          status: "COMPLETED",
          executionStatus: "NOT_REQUIRED",
          requestedAmount: data.amount,
          amount: data.amount,
          userId,
          sourceStationId: data.sourceStationId,
          destinationStationId: data.destinationStationId,
          createdByUserId: userId,
          idempotencyKey: idempotencyKey ?? null,
          requestHash: requestHash ?? null,
          processedAt: new Date(),
        })
        .returning();

      // 5. Post balanced ledger entries: Debit source USER_ALLOCATED, Credit destination USER_ALLOCATED
      await ledgerService.postBalancedMovement(tx, {
        transactionId: transaction!.id,
        entries: [
          {
            financialAccountId: sourceAllocated.id,
            entryType: "DEBIT",
            amount: data.amount,
          },
          {
            financialAccountId: destAllocated.id,
            entryType: "CREDIT",
            amount: data.amount,
          },
        ],
        actorUserId: userId,
        memo: `Transferred from station ${data.sourceStationId} to ${data.destinationStationId}`,
      });

      await financialEventsService.recordEvent(
        {
          transactionId: transaction!.id,
          eventType: "TRANSFER_COMPLETED",
          newStatus: "COMPLETED",
          newExecutionStatus: "NOT_REQUIRED",
          actorUserId: userId,
          idempotencyKey,
          requestHash,
          metadata: {
            amount: data.amount,
            sourceStationId: data.sourceStationId,
            destinationStationId: data.destinationStationId,
          },
        },
        tx,
      );

      return transaction!;
    });
  }
}

export const walletService = new WalletService();

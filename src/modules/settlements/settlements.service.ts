import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client.js";
import { bankAccounts } from "../../db/schema/bank-accounts.js";
import { financialTransactions } from "../../db/schema/financial-transactions.js";
import { stations } from "../../db/schema/stations.js";
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

export class SettlementsService {
  /**
   * Retrieves all stations eligible for settlement (AvailableSettlement >= minimumSettlementAmount).
   */
  async getEligibleStations() {
    const allStations = await db
      .select()
      .from(stations)
      .where(eq(stations.status, "ACTIVE"));

    const eligible = [];
    for (const station of allStations) {
      const summary = await balanceService.getStationPayableSummary(station.id);
      if (summary.isEligibleForSettlement) {
        eligible.push({
          station,
          summary,
        });
      }
    }

    return eligible;
  }

  /**
   * Admin creates a settlement request held against STATION_PAYABLE.
   */
  async createSettlementRequest(
    adminUserId: string,
    data: {
      stationId: string;
      bankAccountId: string;
      requestedAmount: string;
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
      // 1. Verify station is active
      const [station] = await tx
        .select()
        .from(stations)
        .where(and(eq(stations.id, data.stationId), eq(stations.status, "ACTIVE")))
        .limit(1);

      if (!station) {
        throw new NotFoundError(`Station not found or inactive: ${data.stationId}`);
      }

      // 2. Verify bank account belongs to station and is active
      const [account] = await tx
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.id, data.bankAccountId),
            eq(bankAccounts.stationId, data.stationId),
            eq(bankAccounts.isActive, true),
          ),
        )
        .limit(1);

      if (!account) {
        throw new BadRequestError("Invalid or inactive station bank account");
      }

      // 3. Verify requestedAmount >= station.minimumSettlementAmount
      if (compareMonetary(data.requestedAmount, station.minimumSettlementAmount) < 0) {
        throw new UnprocessableContentError(
          `Requested settlement amount (${data.requestedAmount}) is below the station minimum settlement threshold of ${station.minimumSettlementAmount}`,
        );
      }

      // 4. Lock STATION_PAYABLE account and check available payable balance
      const stationPayable = await financialAccountService.getOrCreateStationPayableAccount(
        data.stationId,
        tx,
      );
      await financialAccountService.lockAccounts([stationPayable.id], tx);

      const availablePayable = await balanceService.getAvailableBalance(
        stationPayable.id,
        "STATION_PAYABLE",
        tx,
      );

      if (compareMonetary(availablePayable, data.requestedAmount) < 0) {
        throw new UnprocessableContentError(
          `Requested amount (${data.requestedAmount}) exceeds station available payable balance (${availablePayable})`,
        );
      }

      // 5. Create PENDING settlement transaction with hold
      const [transaction] = await tx
        .insert(financialTransactions)
        .values({
          transactionType: "SETTLEMENT",
          status: "PENDING",
          executionStatus: "NOT_STARTED",
          requestedAmount: data.requestedAmount,
          amount: null,
          stationId: data.stationId,
          bankAccountId: data.bankAccountId,
          createdByUserId: adminUserId,
          holdAccountId: stationPayable.id,
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
          eventType: "SETTLEMENT_REQUESTED",
          newStatus: "PENDING",
          newExecutionStatus: "NOT_STARTED",
          actorUserId: adminUserId,
          idempotencyKey,
          requestHash,
          metadata: {
            stationId: data.stationId,
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
   * Admin starts the external bank transfer for a settlement, reserving central cash commitment.
   */
  async startSettlement(adminUserId: string, transactionId: string) {
    return withTransaction(async (tx) => {
      const [transaction] = await tx
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.id, transactionId))
        .for("update");

      if (!transaction) {
        throw new NotFoundError(`Transaction not found: ${transactionId}`);
      }

      if (transaction.transactionType !== "SETTLEMENT") {
        throw new BadRequestError("Only SETTLEMENT transactions can be started via this endpoint");
      }

      if (transaction.status !== "PENDING") {
        throw new ConflictError(`Transaction is not pending (status: ${transaction.status})`);
      }

      // Lock PLATFORM_CASH and check uncommitted cash
      const cashAccount = await financialAccountService.ensurePlatformCashAccount(tx);
      await financialAccountService.lockAccounts([cashAccount.id], tx);

      const cashSummary = await balanceService.getPlatformCashSummary(tx);
      if (compareMonetary(cashSummary.availableCash, transaction.requestedAmount) < 0) {
        throw new UnprocessableContentError(
          `Platform central cash (${cashSummary.availableCash} uncommitted) cannot cover settlement of ${transaction.requestedAmount}`,
        );
      }

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
          eventType: "SETTLEMENT_PROCESSING_STARTED",
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
   * Admin confirms external bank transfer succeeded for a settlement.
   */
  async confirmSettlementSuccess(
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
        throw new BadRequestError("Actual amount must match requested amount");
      }

      // Check unique reference
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

      // Lock accounts: STATION_PAYABLE and PLATFORM_CASH
      const cashAccount = await financialAccountService.ensurePlatformCashAccount(tx);
      const stationPayable = await financialAccountService.getOrCreateStationPayableAccount(
        transaction.stationId!,
        tx,
      );

      await financialAccountService.lockAccounts([stationPayable.id, cashAccount.id], tx);

      // Post balanced ledger movement: Debit STATION_PAYABLE, Credit PLATFORM_CASH
      await ledgerService.postBalancedMovement(tx, {
        transactionId: transaction.id,
        entries: [
          {
            financialAccountId: stationPayable.id,
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
        memo: `Settlement transfer confirmed: ref ${data.outgoingBankReference}`,
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
          eventType: "SETTLEMENT_CONFIRMED_SUCCESS",
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
   * Admin confirms external bank transfer failed for a settlement.
   */
  async confirmSettlementFailure(adminUserId: string, transactionId: string, reason: string) {
    return withTransaction(async (tx) => {
      const [transaction] = await tx
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.id, transactionId))
        .for("update");

      if (!transaction) {
        throw new NotFoundError(`Transaction not found: ${transactionId}`);
      }

      // Release station hold
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
          eventType: "SETTLEMENT_CONFIRMED_FAILURE",
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
   * Marks settlement as UNKNOWN, preserving station hold and cash commitment.
   */
  async markSettlementUnknown(adminUserId: string, transactionId: string, reason: string) {
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
          eventType: "SETTLEMENT_OUTCOME_UNKNOWN",
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

  async getAdminSettlements() {
    return db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.transactionType, "SETTLEMENT"))
      .orderBy(desc(financialTransactions.createdAt))
      .limit(100);
  }

  async getStationSettlements(stationId: string) {
    return db
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.stationId, stationId),
          eq(financialTransactions.transactionType, "SETTLEMENT"),
        ),
      )
      .orderBy(desc(financialTransactions.createdAt));
  }
}

export const settlementsService = new SettlementsService();

import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "../../db/client.js";
import { financialTransactionEvents } from "../../db/schema/financial-transaction-events.js";
import { financialTransactions } from "../../db/schema/financial-transactions.js";
import { fuelPurchases } from "../../db/schema/fuel-purchases.js";
import { stationFuelPrices, stations } from "../../db/schema/stations.js";
import { users } from "../../db/schema/users.js";
import { withTransaction, type DatabaseTransaction } from "../../db/transaction.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnprocessableContentError,
} from "../../shared/errors/app-error.js";
import {
  compareMonetary,
  multiplyFuelPrice,
  subtractMonetary,
} from "../../shared/precision/money.js";
import { balanceService } from "../financial-core/balance.service.js";
import { financialAccountService } from "../financial-core/financial-account.service.js";
import { financialEventsService } from "../financial-core/financial-events.service.js";
import type { FuelPurchaseQuoteSnapshot } from "../financial-core/financial.types.js";
import { holdService } from "../financial-core/hold.service.js";
import { idempotencyService } from "../financial-core/idempotency.service.js";
import { ledgerService } from "../financial-core/ledger.service.js";

export class FuelPurchasesService {
  /**
   * User creates a fuel purchase request with hold reservation against USER_ALLOCATED.
   */
  async createPurchaseRequest(
    userId: string,
    data: { stationId: string; requestedAmount: string },
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
      // 1. Validate station is active
      const [station] = await tx
        .select()
        .from(stations)
        .where(and(eq(stations.id, data.stationId), eq(stations.status, "ACTIVE")))
        .limit(1);

      if (!station) {
        throw new BadRequestError("Station not found or inactive");
      }

      // 2. Ensure user has allocated account at this station and lock it
      const userAllocated = await financialAccountService.getOrCreateUserAllocatedAccount(
        userId,
        data.stationId,
        tx,
      );

      await financialAccountService.lockAccounts([userAllocated.id], tx);

      // 3. Check available balance after active holds
      const availableBalance = await balanceService.getAvailableBalance(
        userAllocated.id,
        "USER_ALLOCATED",
        tx,
      );

      if (compareMonetary(availableBalance, data.requestedAmount) < 0) {
        throw new UnprocessableContentError(
          `Insufficient available balance (${availableBalance}) at station ${station.name} for requested amount of ${data.requestedAmount}`,
        );
      }

      // 4. Create financial transaction with 10-minute hold expiration
      const holdExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

      const [transaction] = await tx
        .insert(financialTransactions)
        .values({
          transactionType: "FUEL_PURCHASE",
          status: "PENDING",
          executionStatus: "NOT_STARTED",
          requestedAmount: data.requestedAmount,
          amount: null,
          userId,
          stationId: data.stationId,
          createdByUserId: userId,
          holdAccountId: userAllocated.id,
          holdAmount: data.requestedAmount,
          capturedAmount: "0.00",
          releasedAmount: "0.00",
          holdExpiresAt,
          idempotencyKey: idempotencyKey ?? null,
          requestHash: requestHash ?? null,
        })
        .returning();

      // 5. Record hold-created event
      await financialEventsService.recordEvent(
        {
          transactionId: transaction!.id,
          eventType: "HOLD_CREATED",
          newStatus: "PENDING",
          newExecutionStatus: "NOT_STARTED",
          actorUserId: userId,
          idempotencyKey,
          requestHash,
          metadata: {
            holdAmount: data.requestedAmount,
            holdAccountId: userAllocated.id,
            holdExpiresAt: holdExpiresAt.toISOString(),
          },
        },
        tx,
      );

      return transaction!;
    });
  }

  /**
   * Station attendant starts dispensing after locking transaction and creating an accepted quote snapshot.
   */
  async startDispensing(
    attendantUserId: string,
    transactionId: string,
    data: { fuelType: string; plannedQuantity: string },
  ) {
    return withTransaction(async (tx) => {
      // 1. Lock transaction row
      const [transaction] = await tx
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.id, transactionId))
        .for("update");

      if (!transaction) {
        throw new NotFoundError(`Transaction not found: ${transactionId}`);
      }

      if (transaction.transactionType !== "FUEL_PURCHASE") {
        throw new BadRequestError("Only FUEL_PURCHASE transactions can be started via this endpoint");
      }

      if (transaction.status !== "PENDING" || transaction.executionStatus !== "NOT_STARTED") {
        throw new ConflictError(
          `Transaction cannot be started (status: ${transaction.status}, execution: ${transaction.executionStatus})`,
        );
      }

      // 2. Verify hold has not expired
      if (transaction.holdExpiresAt && transaction.holdExpiresAt <= new Date()) {
        throw new ConflictError("Fuel purchase hold authorization has expired");
      }

      // 3. Retrieve current valid fuel price from database for this station
      const now = new Date();
      const [priceRecord] = await tx
        .select()
        .from(stationFuelPrices)
        .where(
          and(
            eq(stationFuelPrices.stationId, transaction.stationId!),
            eq(stationFuelPrices.fuelType, data.fuelType.toUpperCase()),
            lte(stationFuelPrices.validFrom, now),
            or(isNull(stationFuelPrices.validUntil), sql`${stationFuelPrices.validUntil} > ${now}`),
          ),
        )
        .orderBy(desc(stationFuelPrices.validFrom))
        .limit(1);

      if (!priceRecord) {
        throw new BadRequestError(
          `No active fuel price configured for fuel type ${data.fuelType} at this station`,
        );
      }

      // 4. Calculate planned total using exact decimal arithmetic and HALF_UP rounding
      const plannedTotal = multiplyFuelPrice(data.plannedQuantity, priceRecord.pricePerLiter);

      if (compareMonetary(plannedTotal, transaction.requestedAmount) > 0) {
        throw new UnprocessableContentError(
          `Planned total (${plannedTotal}) exceeds authorized hold amount (${transaction.requestedAmount})`,
        );
      }

      // 5. Save quote snapshot in immutable transaction event
      const quoteSnapshot: FuelPurchaseQuoteSnapshot = {
        fuelType: data.fuelType.toUpperCase(),
        plannedQuantity: data.plannedQuantity,
        unitPrice: priceRecord.pricePerLiter,
        plannedTotal,
        attendantId: attendantUserId,
        quotedAt: now.toISOString(),
      };

      await financialEventsService.recordEvent(
        {
          transactionId: transaction.id,
          eventType: "FUEL_PURCHASE_QUOTE_ACCEPTED",
          previousStatus: "PENDING",
          newStatus: "PROCESSING",
          previousExecutionStatus: "NOT_STARTED",
          newExecutionStatus: "IN_PROGRESS",
          actorUserId: attendantUserId,
          metadata: quoteSnapshot as unknown as Record<string, unknown>,
        },
        tx,
      );

      // 6. Transition transaction to PROCESSING and IN_PROGRESS
      const [updated] = await tx
        .update(financialTransactions)
        .set({
          status: "PROCESSING",
          executionStatus: "IN_PROGRESS",
          executionStartedAt: now,
          updatedAt: now,
        })
        .where(eq(financialTransactions.id, transaction.id))
        .returning();

      return {
        transaction: updated!,
        quote: quoteSnapshot,
      };
    });
  }

  /**
   * Station attendant completes dispensing with actual dispensed quantity.
   */
  async completeDispensing(
    attendantUserId: string,
    transactionId: string,
    data: { actualQuantity: string },
  ) {
    return withTransaction(async (tx) => {
      // 1. Lock transaction row
      const [transaction] = await tx
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.id, transactionId))
        .for("update");

      if (!transaction) {
        throw new NotFoundError(`Transaction not found: ${transactionId}`);
      }

      if (transaction.transactionType !== "FUEL_PURCHASE") {
        throw new BadRequestError("Only FUEL_PURCHASE transactions can be completed here");
      }

      if (transaction.status !== "PROCESSING" || transaction.executionStatus !== "IN_PROGRESS") {
        throw new ConflictError(
          `Transaction is not in progress (status: ${transaction.status}, execution: ${transaction.executionStatus})`,
        );
      }

      // 2. Load the quote event
      const [quoteEvent] = await tx
        .select()
        .from(financialTransactionEvents)
        .where(
          and(
            eq(financialTransactionEvents.transactionId, transaction.id),
            eq(financialTransactionEvents.eventType, "FUEL_PURCHASE_QUOTE_ACCEPTED"),
          ),
        )
        .orderBy(desc(financialTransactionEvents.createdAt))
        .limit(1);

      if (!quoteEvent) {
        throw new ConflictError("No accepted fuel quote event found for this transaction");
      }

      const quote = quoteEvent.metadata as unknown as FuelPurchaseQuoteSnapshot;

      // 3. Verify actual quantity <= planned quantity
      if (Number(data.actualQuantity) > Number(quote.plannedQuantity)) {
        throw new UnprocessableContentError(
          `Actual quantity (${data.actualQuantity}) cannot exceed authorized planned quantity (${quote.plannedQuantity})`,
        );
      }

      // 4. Calculate actual total using exact arithmetic and the snapshot unit price
      const actualTotal = multiplyFuelPrice(data.actualQuantity, quote.unitPrice);

      if (compareMonetary(actualTotal, transaction.requestedAmount) > 0) {
        throw new ConflictError(
          `Actual total (${actualTotal}) exceeds authorized hold (${transaction.requestedAmount}); admin reconciliation required`,
        );
      }

      // 5. Ensure accounts exist and lock in deterministic order
      const userAllocated = await financialAccountService.getOrCreateUserAllocatedAccount(
        transaction.userId!,
        transaction.stationId!,
        tx,
      );
      const stationPayable = await financialAccountService.getOrCreateStationPayableAccount(
        transaction.stationId!,
        tx,
      );

      await financialAccountService.lockAccounts([userAllocated.id, stationPayable.id], tx);

      // 6. Insert detail row in fuel_purchases
      await tx.insert(fuelPurchases).values({
        financialTransactionId: transaction.id,
        fuelType: quote.fuelType,
        quantity: data.actualQuantity,
        unitPrice: quote.unitPrice,
        attendantId: attendantUserId,
      });

      // 7. Settle hold: capturedAmount = actualTotal, releasedAmount = holdAmount - actualTotal
      const releasedRemainder = subtractMonetary(transaction.holdAmount, actualTotal);

      // 8. Post double-entry balanced ledger movement: Debit USER_ALLOCATED, Credit STATION_PAYABLE
      await ledgerService.postBalancedMovement(tx, {
        transactionId: transaction.id,
        entries: [
          {
            financialAccountId: userAllocated.id,
            entryType: "DEBIT",
            amount: actualTotal,
          },
          {
            financialAccountId: stationPayable.id,
            entryType: "CREDIT",
            amount: actualTotal,
          },
        ],
        actorUserId: attendantUserId,
        memo: `Fuel purchase: ${data.actualQuantity} L of ${quote.fuelType} @ ${quote.unitPrice}`,
      });

      // 9. Update transaction to COMPLETED
      const [updated] = await tx
        .update(financialTransactions)
        .set({
          amount: actualTotal,
          capturedAmount: actualTotal,
          releasedAmount: releasedRemainder,
          status: "COMPLETED",
          executionStatus: "SUCCEEDED",
          processedByUserId: attendantUserId,
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(financialTransactions.id, transaction.id))
        .returning();

      // 10. Record completion event
      await financialEventsService.recordEvent(
        {
          transactionId: transaction.id,
          eventType: "FUEL_PURCHASE_COMPLETED",
          previousStatus: "PROCESSING",
          newStatus: "COMPLETED",
          previousExecutionStatus: "IN_PROGRESS",
          newExecutionStatus: "SUCCEEDED",
          actorUserId: attendantUserId,
          metadata: {
            actualQuantity: data.actualQuantity,
            unitPrice: quote.unitPrice,
            actualTotal,
            releasedRemainder,
          },
        },
        tx,
      );

      return updated!;
    });
  }

  /**
   * Cancels a PENDING fuel purchase and releases the hold.
   */
  async cancelPurchase(userId: string, transactionId: string) {
    return withTransaction(async (tx) => {
      const [transaction] = await tx
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.id, transactionId))
        .for("update");

      if (!transaction) {
        throw new NotFoundError(`Transaction not found: ${transactionId}`);
      }

      if (transaction.userId !== userId) {
        throw new BadRequestError("You can only cancel your own purchase request");
      }

      if (transaction.status !== "PENDING" || transaction.executionStatus !== "NOT_STARTED") {
        throw new ConflictError(
          `Cannot cancel purchase with status: ${transaction.status} and execution: ${transaction.executionStatus}`,
        );
      }

      // Release full hold
      const [updated] = await tx
        .update(financialTransactions)
        .set({
          capturedAmount: "0.00",
          releasedAmount: transaction.holdAmount,
          status: "CANCELLED",
          executionStatus: "NOT_REQUIRED",
          updatedAt: new Date(),
        })
        .where(eq(financialTransactions.id, transaction.id))
        .returning();

      await financialEventsService.recordEvent(
        {
          transactionId: transaction.id,
          eventType: "FUEL_PURCHASE_CANCELLED",
          previousStatus: "PENDING",
          newStatus: "CANCELLED",
          previousExecutionStatus: "NOT_STARTED",
          newExecutionStatus: "NOT_REQUIRED",
          actorUserId: userId,
          metadata: { releasedAmount: transaction.holdAmount },
        },
        tx,
      );

      return updated!;
    });
  }

  /**
   * Marks dispensing result as unknown, preserving the outstanding hold for admin reconciliation.
   */
  async markPurchaseUnknown(actorUserId: string, transactionId: string, reason: string) {
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
          eventType: "FUEL_PURCHASE_OUTCOME_UNKNOWN",
          previousExecutionStatus: transaction.executionStatus,
          newExecutionStatus: "UNKNOWN",
          actorUserId,
          metadata: { reason },
        },
        tx,
      );

      return updated!;
    });
  }

  /**
   * Safe expiration routine for unstarted purchases whose hold_expires_at has passed.
   */
  async expireUnstartedPurchases() {
    return withTransaction(async (tx) => {
      const now = new Date();
      const expiredList = await tx
        .select()
        .from(financialTransactions)
        .where(
          and(
            eq(financialTransactions.transactionType, "FUEL_PURCHASE"),
            eq(financialTransactions.status, "PENDING"),
            eq(financialTransactions.executionStatus, "NOT_STARTED"),
            lte(financialTransactions.holdExpiresAt, now),
          ),
        )
        .for("update");

      const expiredCount = expiredList.length;

      for (const item of expiredList) {
        await tx
          .update(financialTransactions)
          .set({
            capturedAmount: "0.00",
            releasedAmount: item.holdAmount,
            status: "CANCELLED",
            executionStatus: "NOT_REQUIRED",
            resolutionNote: "Hold authorization expired",
            updatedAt: now,
          })
          .where(eq(financialTransactions.id, item.id));

        await financialEventsService.recordEvent(
          {
            transactionId: item.id,
            eventType: "HOLD_EXPIRED",
            previousStatus: "PENDING",
            newStatus: "CANCELLED",
            previousExecutionStatus: "NOT_STARTED",
            newExecutionStatus: "NOT_REQUIRED",
            metadata: { releasedAmount: item.holdAmount },
          },
          tx,
        );
      }

      return { expiredCount };
    });
  }

  async getUserPurchases(userId: string) {
    return db
      .select({
        id: financialTransactions.id,
        transactionId: financialTransactions.id,
        stationId: financialTransactions.stationId,
        station_id: financialTransactions.stationId,
        stationName: stations.name,
        station_name: stations.name,
        customerName: users.fullName,
        customer_name: users.fullName,
        maximumAmount: financialTransactions.requestedAmount,
        maximum_amount: financialTransactions.requestedAmount,
        amount: sql<string>`coalesce(${financialTransactions.capturedAmount}, ${financialTransactions.requestedAmount})`,
        requestedAmount: financialTransactions.requestedAmount,
        capturedAmount: financialTransactions.capturedAmount,
        fuelType: fuelPurchases.fuelType,
        fuel_type: fuelPurchases.fuelType,
        quantity: fuelPurchases.quantity,
        status: financialTransactions.status,
        createdAt: financialTransactions.createdAt,
        created_at: financialTransactions.createdAt,
      })
      .from(financialTransactions)
      .leftJoin(stations, eq(stations.id, financialTransactions.stationId))
      .leftJoin(users, eq(users.id, financialTransactions.userId))
      .leftJoin(fuelPurchases, eq(fuelPurchases.financialTransactionId, financialTransactions.id))
      .where(
        and(
          eq(financialTransactions.userId, userId),
          eq(financialTransactions.transactionType, "FUEL_PURCHASE"),
        ),
      )
      .orderBy(desc(financialTransactions.createdAt));
  }

  async getStationPurchases(stationId: string) {
    return db
      .select({
        id: financialTransactions.id,
        transactionId: financialTransactions.id,
        stationId: financialTransactions.stationId,
        station_id: financialTransactions.stationId,
        stationName: stations.name,
        station_name: stations.name,
        customerName: users.fullName,
        customer_name: users.fullName,
        maximumAmount: financialTransactions.requestedAmount,
        maximum_amount: financialTransactions.requestedAmount,
        amount: sql<string>`coalesce(${financialTransactions.capturedAmount}, ${financialTransactions.requestedAmount})`,
        requestedAmount: financialTransactions.requestedAmount,
        capturedAmount: financialTransactions.capturedAmount,
        fuelType: fuelPurchases.fuelType,
        fuel_type: fuelPurchases.fuelType,
        quantity: fuelPurchases.quantity,
        status: financialTransactions.status,
        createdAt: financialTransactions.createdAt,
        created_at: financialTransactions.createdAt,
      })
      .from(financialTransactions)
      .leftJoin(stations, eq(stations.id, financialTransactions.stationId))
      .leftJoin(users, eq(users.id, financialTransactions.userId))
      .leftJoin(fuelPurchases, eq(fuelPurchases.financialTransactionId, financialTransactions.id))
      .where(
        and(
          eq(financialTransactions.stationId, stationId),
          eq(financialTransactions.transactionType, "FUEL_PURCHASE"),
        ),
      )
      .orderBy(desc(financialTransactions.createdAt));
  }

  async getPurchaseById(transactionId: string) {
    const [transaction] = await db
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.id, transactionId),
          eq(financialTransactions.transactionType, "FUEL_PURCHASE"),
        ),
      )
      .limit(1);

    if (!transaction) {
      throw new NotFoundError(`Fuel purchase transaction not found: ${transactionId}`);
    }

    const [purchaseDetail] = await db
      .select()
      .from(fuelPurchases)
      .where(eq(fuelPurchases.financialTransactionId, transactionId))
      .limit(1);

    const events = await db
      .select()
      .from(financialTransactionEvents)
      .where(eq(financialTransactionEvents.transactionId, transactionId))
      .orderBy(financialTransactionEvents.createdAt);

    return {
      transaction,
      purchaseDetail: purchaseDetail ?? null,
      events,
    };
  }
}

export const fuelPurchasesService = new FuelPurchasesService();

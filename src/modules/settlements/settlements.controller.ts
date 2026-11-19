import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";

import { db } from "../../db/client.js";
import { bankAccounts } from "../../db/schema/bank-accounts.js";
import { stations } from "../../db/schema/stations.js";
import { getValidatedData } from "../../middleware/validate-request.js";
import { BadRequestError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/http/response.js";
import { balanceService } from "../financial-core/balance.service.js";
import type {
  confirmSettlementFailureSchema,
  confirmSettlementSuccessSchema,
  createSettlementSchema,
  markSettlementUnknownSchema,
} from "./settlements.schemas.js";
import { settlementsService } from "./settlements.service.js";

export class SettlementsController {
  async getEligibleStations(_req: Request, res: Response) {
    const eligible = await settlementsService.getEligibleStations();
    const rows = eligible.map(({ station, summary }) => ({
      id: station.id,
      station_id: station.id,
      station_name: station.name,
      stationName: station.name,
      payable_balance: summary.ledgerBalance,
      payableBalance: summary.ledgerBalance,
      minimum_settlement_amount: summary.minimumSettlementAmount,
      minimumSettlementAmount: summary.minimumSettlementAmount,
      available_amount: summary.availableSettlement,
      availableAmount: summary.availableSettlement,
    }));
    return sendSuccess(res, rows, 200);
  }

  async listSettlements(_req: Request, res: Response) {
    const settlements = await settlementsService.getAdminSettlements();
    return sendSuccess(res, settlements, 200);
  }

  async createSettlement(req: Request, res: Response) {
    const idempotencyKey = req.header("Idempotency-Key");
    if (!idempotencyKey) {
      throw new BadRequestError("Idempotency-Key header is required for settlement creation");
    }

    const { body } = getValidatedData<typeof createSettlementSchema._output>(res);
    const transaction = await settlementsService.createSettlementRequest(
      req.user!.id,
      body,
      idempotencyKey,
    );

    return sendSuccess(res, transaction, 201);
  }

  async executeSettlement(req: Request, res: Response) {
    const stationId = req.params.stationId as string;
    const { amount, bank_reference, bankReference } = req.body || {};
    const ref = bank_reference || bankReference;
    if (!ref || !amount) {
      throw new BadRequestError("amount and bank_reference are required");
    }

    // Find station's active primary bank account or first active bank account
    let [account] = await db
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.stationId, stationId), eq(bankAccounts.isActive, true)))
      .limit(1);

    if (!account) {
      const [station] = await db.select().from(stations).where(eq(stations.id, stationId)).limit(1);
      const [created] = await db
        .insert(bankAccounts)
        .values({
          stationId,
          userId: null,
          bankName: "بنك الخرطوم",
          accountNumber: `STATION-${stationId.slice(0, 8)}`,
          accountHolderName: station?.name || "Station Account",
          isPrimary: true,
          isActive: true,
        })
        .returning();
      account = created;
    }

    const idempotencyKey = req.header("Idempotency-Key") || `settle-${stationId}-${Date.now()}`;
    const formattedAmount = typeof amount === "number" ? amount.toFixed(2) : String(amount);

    const transaction = await settlementsService.createSettlementRequest(
      req.user!.id,
      {
        stationId,
        bankAccountId: account.id,
        requestedAmount: formattedAmount.includes(".") ? formattedAmount : `${formattedAmount}.00`,
      },
      idempotencyKey,
    );

    await settlementsService.startSettlement(req.user!.id, transaction.id);

    const completed = await settlementsService.confirmSettlementSuccess(
      req.user!.id,
      transaction.id,
      {
        actualAmount: formattedAmount.includes(".") ? formattedAmount : `${formattedAmount}.00`,
        outgoingBankReference: ref,
      },
    );

    return sendSuccess(res, completed, 201);
  }

  async startSettlement(req: Request, res: Response) {
    const transactionId = req.params.transactionId as string;
    const updated = await settlementsService.startSettlement(req.user!.id, transactionId);
    return sendSuccess(res, updated, 200);
  }

  async confirmSuccess(req: Request, res: Response) {
    const transactionId = req.params.transactionId as string;
    const { body } = getValidatedData<typeof confirmSettlementSuccessSchema._output>(res);
    const updated = await settlementsService.confirmSettlementSuccess(
      req.user!.id,
      transactionId,
      body,
    );
    return sendSuccess(res, updated, 200);
  }

  async confirmFailure(req: Request, res: Response) {
    const transactionId = req.params.transactionId as string;
    const { body } = getValidatedData<typeof confirmSettlementFailureSchema._output>(res);
    const updated = await settlementsService.confirmSettlementFailure(
      req.user!.id,
      transactionId,
      body.reason,
    );
    return sendSuccess(res, updated, 200);
  }

  async markUnknown(req: Request, res: Response) {
    const transactionId = req.params.transactionId as string;
    const { body } = getValidatedData<typeof markSettlementUnknownSchema._output>(res);
    const updated = await settlementsService.markSettlementUnknown(
      req.user!.id,
      transactionId,
      body.reason,
    );
    return sendSuccess(res, updated, 200);
  }

  async listStationSettlements(req: Request, res: Response) {
    const stationId = req.params.stationId as string;
    const list = await settlementsService.getStationSettlements(stationId);
    return sendSuccess(res, list, 200);
  }

  async getStationFinancialSummary(req: Request, res: Response) {
    const stationId = req.params.stationId as string;
    const [station] = await db
      .select()
      .from(stations)
      .where(eq(stations.id, stationId))
      .limit(1);

    const summary = await balanceService.getStationPayableSummary(stationId);
    const settlements = await settlementsService.getStationSettlements(stationId);
    const payload = {
      ...summary,
      station_id: summary.stationId,
      station_name: station?.name || "",
      stationName: station?.name || "",
      payable_balance: summary.ledgerBalance,
      payableBalance: summary.ledgerBalance,
      reserved_amount: summary.activeHolds,
      reservedAmount: summary.activeHolds,
      available_for_settlement: summary.availableSettlement,
      availableSettlement: summary.availableSettlement,
      settlement_count: settlements.length,
      finance: {
        station_id: summary.stationId,
        station_name: station?.name || "",
        stationName: station?.name || "",
        payable_balance: summary.ledgerBalance,
        payableBalance: summary.ledgerBalance,
        reserved_amount: summary.activeHolds,
        available_for_settlement: summary.availableSettlement,
        settlement_count: settlements.length,
      },
    };
    return sendSuccess(res, payload, 200);
  }
}

export const settlementsController = new SettlementsController();

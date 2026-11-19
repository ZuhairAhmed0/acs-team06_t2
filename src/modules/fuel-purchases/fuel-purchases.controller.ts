import type { Request, Response } from "express";

import { db } from "../../db/client.js";
import { stationMembers } from "../../db/schema/stations.js";
import { and, eq } from "drizzle-orm";
import { getValidatedData } from "../../middleware/validate-request.js";
import { BadRequestError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/http/response.js";
import type {
  completeDispensingSchema,
  createFuelPurchaseSchema,
  markUnknownSchema,
  startDispensingSchema,
} from "./fuel-purchases.schemas.js";
import { fuelPurchasesService } from "./fuel-purchases.service.js";

export class FuelPurchasesController {
  async createPurchase(req: Request, res: Response) {
    const idempotencyKey = req.header("Idempotency-Key");
    if (!idempotencyKey) {
      throw new BadRequestError("Idempotency-Key header is required for fuel purchase creation");
    }

    const { body } = getValidatedData<typeof createFuelPurchaseSchema._output>(res);
    const transaction = await fuelPurchasesService.createPurchaseRequest(
      req.user!.id,
      body,
      idempotencyKey,
    );

    return sendSuccess(res, transaction, 201);
  }

  async listUserPurchases(req: Request, res: Response) {
    // Check if the user is acting as an ATTENDANT
    const [attendantMembership] = await db
      .select()
      .from(stationMembers)
      .where(
        and(
          eq(stationMembers.userId, req.user!.id),
          eq(stationMembers.role, "ATTENDANT"),
          eq(stationMembers.status, "ACTIVE"),
        ),
      )
      .limit(1);

    if (attendantMembership) {
      const stationPurchases = await fuelPurchasesService.getStationPurchases(
        attendantMembership.stationId,
      );
      return sendSuccess(res, stationPurchases, 200);
    }

    const purchases = await fuelPurchasesService.getUserPurchases(req.user!.id);
    return sendSuccess(res, purchases, 200);
  }

  async getPurchase(req: Request, res: Response) {
    const transactionId = req.params.transactionId as string;
    const detail = await fuelPurchasesService.getPurchaseById(transactionId);
    return sendSuccess(res, detail, 200);
  }

  async listStationPurchases(req: Request, res: Response) {
    const stationId = req.params.stationId as string;
    const purchases = await fuelPurchasesService.getStationPurchases(stationId);
    return sendSuccess(res, purchases, 200);
  }

  async startDispensing(req: Request, res: Response) {
    const transactionId = req.params.transactionId as string;
    const { body } = getValidatedData<typeof startDispensingSchema._output>(res);

    const result = await fuelPurchasesService.startDispensing(
      req.user!.id,
      transactionId,
      body,
    );

    return sendSuccess(res, result, 200);
  }

  async completeDispensing(req: Request, res: Response) {
    const transactionId = req.params.transactionId as string;
    const { body } = getValidatedData<typeof completeDispensingSchema._output>(res);

    const updated = await fuelPurchasesService.completeDispensing(
      req.user!.id,
      transactionId,
      body,
    );

    return sendSuccess(res, updated, 200);
  }

  async confirmPurchase(req: Request, res: Response) {
    const transactionId = req.params.transactionId as string;
    const body = req.body || {};
    const detail = await fuelPurchasesService.getPurchaseById(transactionId);
    if (!detail) {
      throw new BadRequestError("Purchase transaction not found");
    }

    const fuelType = (body.fuel_type || body.fuelType || detail.purchaseDetail?.fuelType || "PETROL").toUpperCase();
    const quantity = body.quantity ? Number(body.quantity).toFixed(3) : "1.000";

    if (detail.transaction.status === "PENDING") {
      await fuelPurchasesService.startDispensing(req.user!.id, transactionId, {
        fuelType,
        plannedQuantity: quantity,
      });
    }

    const updated = await fuelPurchasesService.completeDispensing(req.user!.id, transactionId, {
      actualQuantity: quantity,
    });

    return sendSuccess(res, updated, 200);
  }

  async cancelPurchase(req: Request, res: Response) {
    const transactionId = req.params.transactionId as string;
    const cancelled = await fuelPurchasesService.cancelPurchase(req.user!.id, transactionId);
    return sendSuccess(res, cancelled, 200);
  }

  async markUnknown(req: Request, res: Response) {
    const transactionId = req.params.transactionId as string;
    const { body } = getValidatedData<typeof markUnknownSchema._output>(res);

    const updated = await fuelPurchasesService.markPurchaseUnknown(
      req.user!.id,
      transactionId,
      body.reason,
    );

    return sendSuccess(res, updated, 200);
  }

  async expireUnstarted(_req: Request, res: Response) {
    const result = await fuelPurchasesService.expireUnstartedPurchases();
    return sendSuccess(res, result, 200);
  }
}

export const fuelPurchasesController = new FuelPurchasesController();

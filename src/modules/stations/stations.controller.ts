import type { Request, Response } from "express";
import { and, desc, eq, lte, or, sql } from "drizzle-orm";

import { db } from "../../db/client.js";
import { bankAccounts } from "../../db/schema/bank-accounts.js";
import { financialTransactions } from "../../db/schema/financial-transactions.js";
import { stationFuelPrices, stationMembers, stations } from "../../db/schema/stations.js";
import { users } from "../../db/schema/users.js";
import { getValidatedData } from "../../middleware/validate-request.js";
import { BadRequestError, NotFoundError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/http/response.js";
import type {
  addStationMemberSchema,
  createStationSchema,
  setFuelPriceSchema,
} from "./stations.schemas.js";

export class StationsController {
  async listStations(_req: Request, res: Response) {
    const list = await db
      .select()
      .from(stations)
      .where(eq(stations.status, "ACTIVE"))
      .orderBy(stations.name);

    return sendSuccess(res, list, 200);
  }

  async getStation(req: Request, res: Response) {
    const stationId = req.params.stationId as string;
    const [station] = await db
      .select()
      .from(stations)
      .where(eq(stations.id, stationId))
      .limit(1);

    if (!station) {
      throw new NotFoundError(`Station not found: ${stationId}`);
    }

    return sendSuccess(res, station, 200);
  }

  async createStation(_req: Request, res: Response) {
    const { body } = getValidatedData<typeof createStationSchema._output>(res);

    const [created] = await db
      .insert(stations)
      .values({
        name: body.name,
        address: body.address,
        minimumSettlementAmount: body.minimumSettlementAmount,
        status: "ACTIVE",
      })
      .returning();

    return sendSuccess(res, created, 201);
  }

  async addMember(req: Request, res: Response) {
    const stationId = req.params.stationId as string;
    const { body } = getValidatedData<typeof addStationMemberSchema._output>(res);

    const [user] = await db.select().from(users).where(eq(users.id, body.userId)).limit(1);
    if (!user) {
      throw new NotFoundError(`User not found: ${body.userId}`);
    }

    const [member] = await db
      .insert(stationMembers)
      .values({
        stationId,
        userId: body.userId,
        role: body.role,
        status: "ACTIVE",
      })
      .onConflictDoUpdate({
        target: [stationMembers.stationId, stationMembers.userId],
        set: {
          role: body.role,
          status: "ACTIVE",
          updatedAt: new Date(),
        },
      })
      .returning();

    return sendSuccess(res, member, 200);
  }

  async getFuelPrices(req: Request, res: Response) {
    const stationId = req.params.stationId as string;
    const prices = await db
      .select({
        id: stationFuelPrices.id,
        stationId: stationFuelPrices.stationId,
        station_id: stationFuelPrices.stationId,
        fuelType: stationFuelPrices.fuelType,
        fuel_type: stationFuelPrices.fuelType,
        price: stationFuelPrices.pricePerLiter,
        pricePerLiter: stationFuelPrices.pricePerLiter,
        validFrom: stationFuelPrices.validFrom,
        valid_from: stationFuelPrices.validFrom,
        validUntil: stationFuelPrices.validUntil,
        valid_until: stationFuelPrices.validUntil,
      })
      .from(stationFuelPrices)
      .where(eq(stationFuelPrices.stationId, stationId))
      .orderBy(desc(stationFuelPrices.validFrom));

    return sendSuccess(res, prices, 200);
  }

  async setFuelPrice(req: Request, res: Response) {
    const stationId = req.params.stationId as string;
    const { body } = getValidatedData<typeof setFuelPriceSchema._output>(res);

    const validFrom = body.validFrom ? new Date(body.validFrom) : new Date();
    const validUntil = body.validUntil ? new Date(body.validUntil) : null;

    if (validUntil && validUntil <= validFrom) {
      throw new BadRequestError("validUntil must be greater than validFrom");
    }

    const [created] = await db
      .insert(stationFuelPrices)
      .values({
        stationId,
        fuelType: body.fuelType.toUpperCase(),
        pricePerLiter: body.pricePerLiter,
        validFrom,
        validUntil,
      })
      .returning();

    return sendSuccess(res, created, 201);
  }

  async getStationBankAccounts(req: Request, res: Response) {
    const stationId = req.params.stationId as string;
    const accounts = await db
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.stationId, stationId), eq(bankAccounts.isActive, true)));

    return sendSuccess(res, accounts, 200);
  }

  async addStationBankAccount(req: Request, res: Response) {
    const stationId = req.params.stationId as string;
    const { bankName, accountNumber, accountHolderName, isPrimary } = req.body;

    if (!bankName || !accountNumber || !accountHolderName) {
      throw new BadRequestError("bankName, accountNumber, and accountHolderName are required");
    }

    const [account] = await db
      .insert(bankAccounts)
      .values({
        stationId,
        userId: null,
        bankName,
        accountNumber,
        accountHolderName,
        isPrimary: Boolean(isPrimary),
        isActive: true,
      })
      .returning();

    return sendSuccess(res, account, 201);
  }

  async listStationPurchases(req: Request, res: Response) {
    const stationId = req.params.stationId as string;
    const purchases = await db
      .select()
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.stationId, stationId),
          eq(financialTransactions.transactionType, "FUEL_PURCHASE"),
        ),
      )
      .orderBy(desc(financialTransactions.createdAt));

    return sendSuccess(res, purchases, 200);
  }
}

export const stationsController = new StationsController();

import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";

import { db } from "../../db/client.js";
import { bankAccounts } from "../../db/schema/bank-accounts.js";
import { stationMembers, stations } from "../../db/schema/stations.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireSystemRole } from "../../middleware/authorize.js";
import { getValidatedData, validateRequest } from "../../middleware/validate-request.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/http/response.js";
import { fuelPurchasesController } from "../fuel-purchases/fuel-purchases.controller.js";
import { createFuelPurchaseSchema } from "../fuel-purchases/fuel-purchases.schemas.js";
import { settlementsController } from "../settlements/settlements.controller.js";
import { stationsController } from "../stations/stations.controller.js";
import { setFuelPriceSchema } from "../stations/stations.schemas.js";
import { walletController } from "../wallet/wallet.controller.js";
import {
  allocationSchema,
  approveTopUpSchema,
  rejectTopUpSchema,
  topUpRequestSchema,
  transferAllocationSchema,
} from "../wallet/wallet.schemas.js";

export const frontendCompatRouter = Router();

frontendCompatRouter.use([
  "/topups",
  "/admin/topups",
  "/allocations",
  "/allocation-transfers",
  "/purchases",
  "/station",
  "/stations/:stationId/prices",
  "/users/me/bank-accounts",
], authenticate);

// -------------------------------------------------------------
// Helper to find owner's active station ID
// -------------------------------------------------------------
async function getOwnerStationId(userId: string, systemRole: string): Promise<string> {
  const [membership] = await db
    .select({ stationId: stationMembers.stationId })
    .from(stationMembers)
    .where(
      and(
        eq(stationMembers.userId, userId),
        eq(stationMembers.role, "OWNER"),
        eq(stationMembers.status, "ACTIVE"),
      ),
    )
    .limit(1);

  if (membership) {
    return membership.stationId;
  }

  // If system admin without specific membership, fallback to first active station
  if (systemRole === "ADMIN") {
    const [firstStation] = await db
      .select({ id: stations.id })
      .from(stations)
      .where(eq(stations.status, "ACTIVE"))
      .limit(1);
    if (firstStation) return firstStation.id;
  }

  throw new ForbiddenError("User is not associated with an active station as OWNER");
}

// -------------------------------------------------------------
// Top-up aliases
// -------------------------------------------------------------
frontendCompatRouter.get("/topups", (req, res, next) => {
  walletController.getUserTopUps(req, res).catch(next);
});

frontendCompatRouter.get("/topups/me", (req, res, next) => {
  walletController.getUserTopUps(req, res).catch(next);
});

frontendCompatRouter.post(
  "/topups",
  validateRequest({ body: topUpRequestSchema }),
  (req, res, next) => {
    walletController.createTopUp(req, res).catch(next);
  },
);

frontendCompatRouter.get(
  "/admin/topups",
  requireSystemRole("ADMIN"),
  (req, res, next) => {
    walletController.getAdminTopUps(req, res).catch(next);
  },
);

frontendCompatRouter.post(
  "/admin/topups/:transactionId/approve",
  requireSystemRole("ADMIN"),
  validateRequest({ body: approveTopUpSchema }),
  (req, res, next) => {
    walletController.approveTopUp(req, res).catch(next);
  },
);

frontendCompatRouter.post(
  "/admin/topups/:transactionId/reject",
  requireSystemRole("ADMIN"),
  validateRequest({ body: rejectTopUpSchema }),
  (req, res, next) => {
    walletController.rejectTopUp(req, res).catch(next);
  },
);

// -------------------------------------------------------------
// Allocations & Transfers aliases
// -------------------------------------------------------------
frontendCompatRouter.get("/allocations", (req, res, next) => {
  walletController.getAllocations(req, res).catch(next);
});

frontendCompatRouter.post(
  "/allocations",
  validateRequest({ body: allocationSchema }),
  (req, res, next) => {
    walletController.createAllocation(req, res).catch(next);
  },
);

frontendCompatRouter.post(
  "/allocation-transfers",
  validateRequest({ body: transferAllocationSchema }),
  (req, res, next) => {
    walletController.createTransfer(req, res).catch(next);
  },
);

// -------------------------------------------------------------
// Fuel Purchases aliases
// -------------------------------------------------------------
frontendCompatRouter.get("/purchases", (req, res, next) => {
  fuelPurchasesController.listUserPurchases(req, res).catch(next);
});

frontendCompatRouter.post(
  "/purchases",
  validateRequest({ body: createFuelPurchaseSchema }),
  (req, res, next) => {
    fuelPurchasesController.createPurchase(req, res).catch(next);
  },
);

frontendCompatRouter.get("/purchases/:transactionId", (req, res, next) => {
  fuelPurchasesController.getPurchase(req, res).catch(next);
});

frontendCompatRouter.post("/purchases/:transactionId/confirm", (req, res, next) => {
  fuelPurchasesController.confirmPurchase(req, res).catch(next);
});

// -------------------------------------------------------------
// Station owner direct views (finance, settings, settlements)
// -------------------------------------------------------------
frontendCompatRouter.get("/station/finance", async (req, res, next) => {
  try {
    const stationId = await getOwnerStationId(req.user!.id, req.user!.systemRole);
    (req.params as any).stationId = stationId;
    return settlementsController.getStationFinancialSummary(req, res);
  } catch (err) {
    next(err);
  }
});

frontendCompatRouter.get("/station/settlement-settings", async (req, res, next) => {
  try {
    const stationId = await getOwnerStationId(req.user!.id, req.user!.systemRole);
    const [station] = await db
      .select({ minimumSettlementAmount: stations.minimumSettlementAmount })
      .from(stations)
      .where(eq(stations.id, stationId))
      .limit(1);

    if (!station) {
      throw new NotFoundError("Station not found");
    }

    return sendSuccess(
      res,
      {
        settings: {
          minimum_settlement_amount: station.minimumSettlementAmount,
          minimumSettlementAmount: station.minimumSettlementAmount,
        },
      },
      200,
    );
  } catch (err) {
    next(err);
  }
});

frontendCompatRouter.patch("/station/settlement-settings", async (req, res, next) => {
  try {
    const stationId = await getOwnerStationId(req.user!.id, req.user!.systemRole);
    const amount = req.body?.minimum_settlement_amount ?? req.body?.minimumSettlementAmount;
    if (!amount || Number(amount) <= 0) {
      throw new BadRequestError("Valid positive minimum settlement amount is required");
    }

    const formatted = typeof amount === "number" ? amount.toFixed(2) : String(amount);
    const [updated] = await db
      .update(stations)
      .set({
        minimumSettlementAmount: formatted.includes(".") ? formatted : `${formatted}.00`,
        updatedAt: new Date(),
      })
      .where(eq(stations.id, stationId))
      .returning({ minimumSettlementAmount: stations.minimumSettlementAmount });

    return sendSuccess(
      res,
      {
        settings: {
          minimum_settlement_amount: updated.minimumSettlementAmount,
          minimumSettlementAmount: updated.minimumSettlementAmount,
        },
      },
      200,
    );
  } catch (err) {
    next(err);
  }
});

frontendCompatRouter.get("/station/settlements", async (req, res, next) => {
  try {
    const stationId = await getOwnerStationId(req.user!.id, req.user!.systemRole);
    (req.params as any).stationId = stationId;
    return settlementsController.listStationSettlements(req, res);
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// Station fuel prices compatibility alias (:stationId/prices)
// -------------------------------------------------------------
frontendCompatRouter.get("/stations/:stationId/prices", (req, res, next) => {
  stationsController.getFuelPrices(req, res).catch(next);
});

frontendCompatRouter.post(
  "/stations/:stationId/prices",
  validateRequest({ body: setFuelPriceSchema }),
  (req, res, next) => {
    stationsController.setFuelPrice(req, res).catch(next);
  },
);

// -------------------------------------------------------------
// User bank accounts compatibility alias (/users/me/bank-accounts)
// -------------------------------------------------------------
frontendCompatRouter.get("/users/me/bank-accounts", async (req, res, next) => {
  try {
    const list = await db
      .select({
        id: bankAccounts.id,
        bankName: bankAccounts.bankName,
        bank_name: bankAccounts.bankName,
        accountNumber: bankAccounts.accountNumber,
        account_number: bankAccounts.accountNumber,
        accountHolderName: bankAccounts.accountHolderName,
        account_holder_name: bankAccounts.accountHolderName,
        isPrimary: bankAccounts.isPrimary,
        isActive: bankAccounts.isActive,
      })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.userId, req.user!.id), eq(bankAccounts.isActive, true)));

    return sendSuccess(res, list, 200);
  } catch (err) {
    next(err);
  }
});

frontendCompatRouter.post("/users/me/bank-accounts", async (req, res, next) => {
  try {
    const bankName = req.body.bank_name || req.body.bankName;
    const accountNumber = req.body.account_number || req.body.accountNumber;
    const accountHolderName = req.body.account_holder_name || req.body.accountHolderName || req.user!.fullName;

    if (!bankName || !accountNumber) {
      throw new BadRequestError("bank_name and account_number are required");
    }

    const [account] = await db
      .insert(bankAccounts)
      .values({
        userId: req.user!.id,
        stationId: null,
        bankName,
        accountNumber,
        accountHolderName,
        isPrimary: Boolean(req.body.isPrimary),
        isActive: true,
      })
      .returning();

    return sendSuccess(
      res,
      {
        ...account,
        bank_name: account.bankName,
        account_number: account.accountNumber,
        account_holder_name: account.accountHolderName,
      },
      201,
    );
  } catch (err) {
    next(err);
  }
});

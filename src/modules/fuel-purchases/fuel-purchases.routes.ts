import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.js";
import { requireStationRole, requireSystemRole } from "../../middleware/authorize.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { fuelPurchasesController } from "./fuel-purchases.controller.js";
import {
  completeDispensingSchema,
  createFuelPurchaseSchema,
  markUnknownSchema,
  startDispensingSchema,
} from "./fuel-purchases.schemas.js";

export const fuelPurchasesRouter = Router();

fuelPurchasesRouter.use(authenticate);

fuelPurchasesRouter.post(
  "/",
  validateRequest({ body: createFuelPurchaseSchema }),
  (req, res, next) => {
    fuelPurchasesController.createPurchase(req, res).catch(next);
  },
);

fuelPurchasesRouter.get("/", (req, res, next) => {
  fuelPurchasesController.listUserPurchases(req, res).catch(next);
});

fuelPurchasesRouter.get("/:transactionId", (req, res, next) => {
  fuelPurchasesController.getPurchase(req, res).catch(next);
});

fuelPurchasesRouter.post(
  "/:transactionId/start",
  validateRequest({ body: startDispensingSchema }),
  (req, res, next) => {
    fuelPurchasesController.startDispensing(req, res).catch(next);
  },
);

fuelPurchasesRouter.post(
  "/:transactionId/complete",
  validateRequest({ body: completeDispensingSchema }),
  (req, res, next) => {
    fuelPurchasesController.completeDispensing(req, res).catch(next);
  },
);

fuelPurchasesRouter.post("/:transactionId/confirm", (req, res, next) => {
  fuelPurchasesController.confirmPurchase(req, res).catch(next);
});

fuelPurchasesRouter.post("/:transactionId/cancel", (req, res, next) => {
  fuelPurchasesController.cancelPurchase(req, res).catch(next);
});

fuelPurchasesRouter.post(
  "/:transactionId/mark-unknown",
  validateRequest({ body: markUnknownSchema }),
  (req, res, next) => {
    fuelPurchasesController.markUnknown(req, res).catch(next);
  },
);

fuelPurchasesRouter.post(
  "/expire-unstarted",
  requireSystemRole("ADMIN"),
  (req, res, next) => {
    fuelPurchasesController.expireUnstarted(req, res).catch(next);
  },
);

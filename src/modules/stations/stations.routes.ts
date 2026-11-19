import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.js";
import { requireStationRole, requireSystemRole } from "../../middleware/authorize.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { stationsController } from "./stations.controller.js";
import { settlementsController } from "../settlements/settlements.controller.js";
import {
  addStationMemberSchema,
  createStationSchema,
  setFuelPriceSchema,
} from "./stations.schemas.js";

export const stationsRouter = Router();

// Public / Authenticated read routes
stationsRouter.get("/", (req, res, next) => {
  stationsController.listStations(req, res).catch(next);
});

stationsRouter.get("/:stationId", (req, res, next) => {
  stationsController.getStation(req, res).catch(next);
});

stationsRouter.get("/:stationId/fuel-prices", (req, res, next) => {
  stationsController.getFuelPrices(req, res).catch(next);
});

// Admin-only station creation & membership
stationsRouter.post(
  "/",
  authenticate,
  requireSystemRole("ADMIN"),
  validateRequest({ body: createStationSchema }),
  (req, res, next) => {
    stationsController.createStation(req, res).catch(next);
  },
);

stationsRouter.post(
  "/:stationId/members",
  authenticate,
  requireSystemRole("ADMIN"),
  validateRequest({ body: addStationMemberSchema }),
  (req, res, next) => {
    stationsController.addMember(req, res).catch(next);
  },
);

// Station Owner or Admin price management
stationsRouter.post(
  "/:stationId/fuel-prices",
  authenticate,
  requireStationRole(["OWNER"]),
  validateRequest({ body: setFuelPriceSchema }),
  (req, res, next) => {
    stationsController.setFuelPrice(req, res).catch(next);
  },
);

// Station bank account management
stationsRouter.get(
  "/:stationId/bank-accounts",
  authenticate,
  requireStationRole(["OWNER"]),
  (req, res, next) => {
    stationsController.getStationBankAccounts(req, res).catch(next);
  },
);

stationsRouter.post(
  "/:stationId/bank-accounts",
  authenticate,
  requireStationRole(["OWNER"]),
  (req, res, next) => {
    stationsController.addStationBankAccount(req, res).catch(next);
  },
);

stationsRouter.get(
  "/:stationId/fuel-purchases",
  authenticate,
  requireStationRole(["OWNER", "ATTENDANT"]),
  (req, res, next) => {
    stationsController.listStationPurchases(req, res).catch(next);
  },
);

stationsRouter.get(
  "/:stationId/settlements",
  authenticate,
  requireStationRole(["OWNER"]),
  (req, res, next) => {
    settlementsController.listStationSettlements(req, res).catch(next);
  },
);

stationsRouter.get(
  "/:stationId/financial-summary",
  authenticate,
  requireStationRole(["OWNER"]),
  (req, res, next) => {
    settlementsController.getStationFinancialSummary(req, res).catch(next);
  },
);

import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.js";
import { requireSystemRole } from "../../middleware/authorize.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { settlementsController } from "./settlements.controller.js";
import {
  confirmSettlementFailureSchema,
  confirmSettlementSuccessSchema,
  createSettlementSchema,
  markSettlementUnknownSchema,
} from "./settlements.schemas.js";

export const adminSettlementsRouter = Router();

adminSettlementsRouter.use(authenticate);
adminSettlementsRouter.use(requireSystemRole("ADMIN"));

adminSettlementsRouter.get("/eligible", (req, res, next) => {
  settlementsController.getEligibleStations(req, res).catch(next);
});

adminSettlementsRouter.post("/:stationId/execute", (req, res, next) => {
  settlementsController.executeSettlement(req, res).catch(next);
});

adminSettlementsRouter.get("/", (req, res, next) => {
  settlementsController.listSettlements(req, res).catch(next);
});

adminSettlementsRouter.post(
  "/",
  validateRequest({ body: createSettlementSchema }),
  (req, res, next) => {
    settlementsController.createSettlement(req, res).catch(next);
  },
);

adminSettlementsRouter.post("/:transactionId/start", (req, res, next) => {
  settlementsController.startSettlement(req, res).catch(next);
});

adminSettlementsRouter.post(
  "/:transactionId/confirm-success",
  validateRequest({ body: confirmSettlementSuccessSchema }),
  (req, res, next) => {
    settlementsController.confirmSuccess(req, res).catch(next);
  },
);

adminSettlementsRouter.post(
  "/:transactionId/confirm-failure",
  validateRequest({ body: confirmSettlementFailureSchema }),
  (req, res, next) => {
    settlementsController.confirmFailure(req, res).catch(next);
  },
);

adminSettlementsRouter.post(
  "/:transactionId/mark-unknown",
  validateRequest({ body: markSettlementUnknownSchema }),
  (req, res, next) => {
    settlementsController.markUnknown(req, res).catch(next);
  },
);

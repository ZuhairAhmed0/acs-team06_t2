import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.js";
import { requireSystemRole } from "../../middleware/authorize.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { reversalsController } from "./reversals.controller.js";
import { createReversalSchema } from "./reversals.schemas.js";

export const adminReversalsRouter = Router();

adminReversalsRouter.use(authenticate);
adminReversalsRouter.use(requireSystemRole("ADMIN"));

adminReversalsRouter.get("/", (req, res, next) => {
  reversalsController.listReversals(req, res).catch(next);
});

adminReversalsRouter.post(
  "/:transactionId/reversal",
  validateRequest({ body: createReversalSchema }),
  (req, res, next) => {
    reversalsController.createReversal(req, res).catch(next);
  },
);

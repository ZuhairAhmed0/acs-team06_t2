import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.js";
import { requireSystemRole } from "../../middleware/authorize.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { withdrawalsController } from "./withdrawals.controller.js";
import {
  confirmOutgoingFailureSchema,
  confirmOutgoingSuccessSchema,
  createWithdrawalSchema,
  markOutgoingUnknownSchema,
} from "./withdrawals.schemas.js";

export const walletWithdrawalsRouter = Router();
export const adminWithdrawalsRouter = Router();

// User routes (/api/v1/wallet/withdrawals)
walletWithdrawalsRouter.use(authenticate);

walletWithdrawalsRouter.post(
  "/",
  validateRequest({ body: createWithdrawalSchema }),
  (req, res, next) => {
    withdrawalsController.createWithdrawal(req, res).catch(next);
  },
);

walletWithdrawalsRouter.get("/", (req, res, next) => {
  withdrawalsController.listUserWithdrawals(req, res).catch(next);
});

// Admin routes (/api/v1/admin/withdrawals)
adminWithdrawalsRouter.use(authenticate);
adminWithdrawalsRouter.use(requireSystemRole("ADMIN"));

adminWithdrawalsRouter.get("/", (req, res, next) => {
  withdrawalsController.listAdminWithdrawals(req, res).catch(next);
});

adminWithdrawalsRouter.post("/:transactionId/approve", (req, res, next) => {
  withdrawalsController.approveWithdrawal(req, res).catch(next);
});

adminWithdrawalsRouter.post(
  "/:transactionId/reject",
  validateRequest({ body: confirmOutgoingFailureSchema }),
  (req, res, next) => {
    withdrawalsController.rejectWithdrawal(req, res).catch(next);
  },
);

adminWithdrawalsRouter.post(
  "/:transactionId/confirm-success",
  validateRequest({ body: confirmOutgoingSuccessSchema }),
  (req, res, next) => {
    withdrawalsController.confirmSuccess(req, res).catch(next);
  },
);

adminWithdrawalsRouter.post(
  "/:transactionId/confirm-failure",
  validateRequest({ body: confirmOutgoingFailureSchema }),
  (req, res, next) => {
    withdrawalsController.confirmFailure(req, res).catch(next);
  },
);

adminWithdrawalsRouter.post(
  "/:transactionId/mark-unknown",
  validateRequest({ body: markOutgoingUnknownSchema }),
  (req, res, next) => {
    withdrawalsController.markUnknown(req, res).catch(next);
  },
);

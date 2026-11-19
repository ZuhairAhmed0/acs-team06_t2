import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.js";
import { requireSystemRole } from "../../middleware/authorize.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { walletController } from "./wallet.controller.js";
import {
  allocationSchema,
  approveTopUpSchema,
  deallocationSchema,
  rejectTopUpSchema,
  topUpRequestSchema,
  transactionHistoryQuerySchema,
  transferAllocationSchema,
} from "./wallet.schemas.js";

export const walletRouter = Router();
export const adminTopUpsRouter = Router();

// ==========================================
// User Wallet Routes (Base: /api/v1/wallet)
// ==========================================
walletRouter.use(authenticate);

walletRouter.get("/", (req, res, next) => {
  walletController.getWalletSummary(req, res).catch(next);
});

walletRouter.get(
  "/transactions",
  validateRequest({ query: transactionHistoryQuerySchema }),
  (req, res, next) => {
    walletController.getTransactionHistory(req, res).catch(next);
  },
);

walletRouter.get("/top-ups", (req, res, next) => {
  walletController.getUserTopUps(req, res).catch(next);
});

walletRouter.get("/allocations", (req, res, next) => {
  walletController.getAllocations(req, res).catch(next);
});

walletRouter.post(
  "/top-ups",
  validateRequest({ body: topUpRequestSchema }),
  (req, res, next) => {
    walletController.createTopUp(req, res).catch(next);
  },
);

walletRouter.post(
  "/allocations",
  validateRequest({ body: allocationSchema }),
  (req, res, next) => {
    walletController.createAllocation(req, res).catch(next);
  },
);

walletRouter.post(
  "/deallocations",
  validateRequest({ body: deallocationSchema }),
  (req, res, next) => {
    walletController.createDeallocation(req, res).catch(next);
  },
);

walletRouter.post(
  "/transfers",
  validateRequest({ body: transferAllocationSchema }),
  (req, res, next) => {
    walletController.createTransfer(req, res).catch(next);
  },
);

// ==========================================
// Admin Top-Up Routes (Base: /api/v1/admin/top-ups)
// ==========================================
adminTopUpsRouter.use(authenticate);
adminTopUpsRouter.use(requireSystemRole("ADMIN"));

adminTopUpsRouter.get("/", (req, res, next) => {
  walletController.getAdminTopUps(req, res).catch(next);
});

adminTopUpsRouter.post(
  "/:transactionId/approve",
  validateRequest({ body: approveTopUpSchema }),
  (req, res, next) => {
    walletController.approveTopUp(req, res).catch(next);
  },
);

adminTopUpsRouter.post(
  "/:transactionId/reject",
  validateRequest({ body: rejectTopUpSchema }),
  (req, res, next) => {
    walletController.rejectTopUp(req, res).catch(next);
  },
);

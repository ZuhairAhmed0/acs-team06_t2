import { Router } from "express";
import { and, desc, eq, inArray, or } from "drizzle-orm";

import { db } from "../../db/client.js";
import { financialTransactionEvents } from "../../db/schema/financial-transaction-events.js";
import { financialTransactions } from "../../db/schema/financial-transactions.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireSystemRole } from "../../middleware/authorize.js";
import { NotFoundError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/http/response.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { reversalsController } from "../reversals/reversals.controller.js";
import { createReversalSchema } from "../reversals/reversals.schemas.js";

export const adminReconciliationRouter = Router();

adminReconciliationRouter.use(authenticate);
adminReconciliationRouter.use(requireSystemRole("ADMIN"));

adminReconciliationRouter.post(
  "/:transactionId/reversal",
  validateRequest({ body: createReversalSchema }),
  (req, res, next) => {
    reversalsController.createReversal(req, res).catch(next);
  },
);

adminReconciliationRouter.get("/needs-review", async (_req, res, next) => {
  try {
    const list = await db
      .select()
      .from(financialTransactions)
      .where(
        or(
          eq(financialTransactions.executionStatus, "UNKNOWN"),
          and(
            eq(financialTransactions.status, "PROCESSING"),
            eq(financialTransactions.executionStatus, "IN_PROGRESS"),
          ),
        ),
      )
      .orderBy(desc(financialTransactions.updatedAt));

    return sendSuccess(res, list, 200);
  } catch (error) {
    next(error);
  }
});

adminReconciliationRouter.get("/:transactionId/events", async (req, res, next) => {
  try {
    const transactionId = req.params.transactionId as string;
    const [txRecord] = await db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.id, transactionId))
      .limit(1);

    if (!txRecord) {
      throw new NotFoundError(`Transaction not found: ${transactionId}`);
    }

    const events = await db
      .select()
      .from(financialTransactionEvents)
      .where(eq(financialTransactionEvents.transactionId, transactionId))
      .orderBy(financialTransactionEvents.createdAt);

    return sendSuccess(res, { transaction: txRecord, events }, 200);
  } catch (error) {
    next(error);
  }
});

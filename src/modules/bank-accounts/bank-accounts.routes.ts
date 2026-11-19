import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/client.js";
import { bankAccounts } from "../../db/schema/bank-accounts.js";
import { authenticate } from "../../middleware/authenticate.js";
import { validateRequest } from "../../middleware/validate-request.js";
import { sendSuccess } from "../../shared/http/response.js";
import { getValidatedData } from "../../middleware/validate-request.js";

export const bankAccountsRouter = Router();

const createBankAccountSchema = z.object({
  bankName: z.string().min(2).max(100),
  accountNumber: z.string().min(4).max(50),
  accountHolderName: z.string().min(2).max(150),
  isPrimary: z.boolean().optional().default(false),
});

bankAccountsRouter.use(authenticate);

bankAccountsRouter.get("/", async (req, res, next) => {
  try {
    const list = await db
      .select()
      .from(bankAccounts)
      .where(
        and(eq(bankAccounts.userId, req.user!.id), eq(bankAccounts.isActive, true)),
      );

    return sendSuccess(res, list, 200);
  } catch (error) {
    next(error);
  }
});

bankAccountsRouter.post(
  "/",
  validateRequest({ body: createBankAccountSchema }),
  async (req, res, next) => {
    try {
      const { body } = getValidatedData<z.infer<typeof createBankAccountSchema>>(res);

      const [account] = await db
        .insert(bankAccounts)
        .values({
          userId: req.user!.id,
          stationId: null,
          bankName: body.bankName,
          accountNumber: body.accountNumber,
          accountHolderName: body.accountHolderName,
          isPrimary: body.isPrimary,
          isActive: true,
        })
        .returning();

      return sendSuccess(res, account, 201);
    } catch (error) {
      next(error);
    }
  },
);

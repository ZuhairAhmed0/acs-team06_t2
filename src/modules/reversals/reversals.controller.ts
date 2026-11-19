import type { Request, Response } from "express";

import { getValidatedData } from "../../middleware/validate-request.js";
import { BadRequestError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/http/response.js";
import type { createReversalSchema } from "./reversals.schemas.js";
import { reversalsService } from "./reversals.service.js";

export class ReversalsController {
  async createReversal(req: Request, res: Response) {
    const transactionId = req.params.transactionId as string;
    const idempotencyKey = req.header("Idempotency-Key");
    if (!idempotencyKey) {
      throw new BadRequestError("Idempotency-Key header is required for reversal execution");
    }

    const { body } = getValidatedData<typeof createReversalSchema._output>(res);
    const reversal = await reversalsService.createReversal(
      req.user!.id,
      transactionId,
      body,
      idempotencyKey,
    );

    return sendSuccess(res, reversal, 201);
  }

  async listReversals(_req: Request, res: Response) {
    const reversals = await reversalsService.getReversals();
    return sendSuccess(res, reversals, 200);
  }
}

export const reversalsController = new ReversalsController();

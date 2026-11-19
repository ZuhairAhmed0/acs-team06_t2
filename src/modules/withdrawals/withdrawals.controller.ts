import type { Request, Response } from "express";

import { getValidatedData } from "../../middleware/validate-request.js";
import { BadRequestError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/http/response.js";
import type {
  confirmOutgoingFailureSchema,
  confirmOutgoingSuccessSchema,
  createWithdrawalSchema,
  markOutgoingUnknownSchema,
} from "./withdrawals.schemas.js";
import { withdrawalsService } from "./withdrawals.service.js";

export class WithdrawalsController {
  async createWithdrawal(req: Request, res: Response) {
    const idempotencyKey = req.header("Idempotency-Key");
    if (!idempotencyKey) {
      throw new BadRequestError("Idempotency-Key header is required for withdrawal request");
    }

    const { body } = getValidatedData<typeof createWithdrawalSchema._output>(res);
    const transaction = await withdrawalsService.createWithdrawalRequest(
      req.user!.id,
      body,
      idempotencyKey,
    );

    return sendSuccess(res, transaction, 201);
  }

  async listUserWithdrawals(req: Request, res: Response) {
    const withdrawals = await withdrawalsService.getUserWithdrawals(req.user!.id);
    return sendSuccess(res, withdrawals, 200);
  }

  async listAdminWithdrawals(_req: Request, res: Response) {
    const withdrawals = await withdrawalsService.getAdminWithdrawals();
    return sendSuccess(res, withdrawals, 200);
  }

  async approveWithdrawal(req: Request, res: Response) {
    const transactionId = req.params.transactionId as string;
    const updated = await withdrawalsService.approveWithdrawal(req.user!.id, transactionId);
    return sendSuccess(res, updated, 200);
  }

  async rejectWithdrawal(req: Request, res: Response) {
    const transactionId = req.params.transactionId as string;
    const { body } = getValidatedData<typeof confirmOutgoingFailureSchema._output>(res);
    const updated = await withdrawalsService.rejectWithdrawal(
      req.user!.id,
      transactionId,
      body.reason,
    );
    return sendSuccess(res, updated, 200);
  }

  async confirmSuccess(req: Request, res: Response) {
    const transactionId = req.params.transactionId as string;
    const { body } = getValidatedData<typeof confirmOutgoingSuccessSchema._output>(res);
    const updated = await withdrawalsService.confirmWithdrawalSuccess(
      req.user!.id,
      transactionId,
      body,
    );
    return sendSuccess(res, updated, 200);
  }

  async confirmFailure(req: Request, res: Response) {
    const transactionId = req.params.transactionId as string;
    const { body } = getValidatedData<typeof confirmOutgoingFailureSchema._output>(res);
    const updated = await withdrawalsService.confirmWithdrawalFailure(
      req.user!.id,
      transactionId,
      body.reason,
    );
    return sendSuccess(res, updated, 200);
  }

  async markUnknown(req: Request, res: Response) {
    const transactionId = req.params.transactionId as string;
    const { body } = getValidatedData<typeof markOutgoingUnknownSchema._output>(res);
    const updated = await withdrawalsService.markWithdrawalUnknown(
      req.user!.id,
      transactionId,
      body.reason,
    );
    return sendSuccess(res, updated, 200);
  }
}

export const withdrawalsController = new WithdrawalsController();

import type { Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";

import { db } from "../../db/client.js";
import { bankAccounts } from "../../db/schema/bank-accounts.js";
import { financialTransactions } from "../../db/schema/financial-transactions.js";
import { users } from "../../db/schema/users.js";
import { BadRequestError } from "../../shared/errors/app-error.js";
import { sendSuccess } from "../../shared/http/response.js";
import { getValidatedData } from "../../middleware/validate-request.js";
import type {
  allocationSchema,
  approveTopUpSchema,
  deallocationSchema,
  rejectTopUpSchema,
  topUpRequestSchema,
  transactionHistoryQuerySchema,
  transferAllocationSchema,
} from "./wallet.schemas.js";
import { walletService } from "./wallet.service.js";

export class WalletController {
  async getWalletSummary(req: Request, res: Response) {
    const summary = await walletService.getWalletSummary(req.user!.id);
    const payload = {
      ...summary,
      availableBalance: summary.availableAccount.spendableBalance,
      available_balance: summary.availableAccount.spendableBalance,
      allocatedBalance: summary.totalAllocatedBalance,
      allocated_balance: summary.totalAllocatedBalance,
      reservedBalance: summary.availableAccount.activeHolds,
      reserved_balance: summary.availableAccount.activeHolds,
      wallet: {
        availableBalance: summary.availableAccount.spendableBalance,
        available_balance: summary.availableAccount.spendableBalance,
        allocatedBalance: summary.totalAllocatedBalance,
        allocated_balance: summary.totalAllocatedBalance,
        reservedBalance: summary.availableAccount.activeHolds,
        reserved_balance: summary.availableAccount.activeHolds,
      },
    };
    return sendSuccess(res, payload, 200);
  }

  async getTransactionHistory(req: Request, res: Response) {
    const { query } = getValidatedData<
      unknown,
      unknown,
      typeof transactionHistoryQuerySchema._output
    >(res);

    const history = await walletService.getTransactionHistory(req.user!.id, query);
    const items = history.items.map((tx: any) => ({
      ...tx,
      description: tx.description || tx.transactionType,
      transaction_type: tx.transactionType,
      transactionType: tx.transactionType,
      amount: tx.capturedAmount || tx.requestedAmount,
      requestedAmount: tx.requestedAmount,
      created_at: tx.createdAt,
      createdAt: tx.createdAt,
    }));
    return sendSuccess(res, items, 200, { pagination: history.pagination });
  }

  async createTopUp(req: Request, res: Response) {
    const idempotencyKey = req.header("Idempotency-Key");
    if (!idempotencyKey) {
      throw new BadRequestError("Idempotency-Key header is required for top-up creation");
    }

    const { body } = getValidatedData<typeof topUpRequestSchema._output>(res);

    let bankAccountId = body.bankAccountId;
    if (!bankAccountId && body.senderBankName && body.senderAccountNumber) {
      const [existing] = await db
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.userId, req.user!.id),
            eq(bankAccounts.accountNumber, body.senderAccountNumber),
            eq(bankAccounts.isActive, true),
          ),
        )
        .limit(1);

      if (existing) {
        bankAccountId = existing.id;
      } else {
        const [created] = await db
          .insert(bankAccounts)
          .values({
            userId: req.user!.id,
            stationId: null,
            bankName: body.senderBankName,
            accountNumber: body.senderAccountNumber,
            accountHolderName: req.user!.fullName,
            isPrimary: false,
            isActive: true,
          })
          .returning();
        bankAccountId = created.id;
      }
    }

    if (!bankAccountId) {
      throw new BadRequestError("bankAccountId or valid sender bank details are required");
    }

    const transaction = await walletService.createTopUpRequest(
      req.user!.id,
      {
        requestedAmount: body.requestedAmount,
        bankAccountId,
        submittedBankReference: body.submittedBankReference,
      },
      idempotencyKey,
    );

    return sendSuccess(res, transaction, 201);
  }

  async getUserTopUps(req: Request, res: Response) {
    const topUps = await db
      .select({
        id: financialTransactions.id,
        amount: financialTransactions.requestedAmount,
        requestedAmount: financialTransactions.requestedAmount,
        bankReference: financialTransactions.submittedBankReference,
        bank_reference: financialTransactions.submittedBankReference,
        status: financialTransactions.status,
        createdAt: financialTransactions.createdAt,
        created_at: financialTransactions.createdAt,
      })
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.userId, req.user!.id),
          eq(financialTransactions.transactionType, "TOP_UP"),
        ),
      )
      .orderBy(desc(financialTransactions.createdAt));

    return sendSuccess(res, topUps, 200);
  }

  async getAdminTopUps(_req: Request, res: Response) {
    const topUps = await db
      .select({
        id: financialTransactions.id,
        userId: financialTransactions.userId,
        userName: users.fullName,
        user_name: users.fullName,
        amount: financialTransactions.requestedAmount,
        requestedAmount: financialTransactions.requestedAmount,
        bankReference: financialTransactions.submittedBankReference,
        bank_reference: financialTransactions.submittedBankReference,
        status: financialTransactions.status,
        createdAt: financialTransactions.createdAt,
        created_at: financialTransactions.createdAt,
      })
      .from(financialTransactions)
      .leftJoin(users, eq(users.id, financialTransactions.userId))
      .where(eq(financialTransactions.transactionType, "TOP_UP"))
      .orderBy(desc(financialTransactions.createdAt))
      .limit(100);

    return sendSuccess(res, topUps, 200);
  }

  async getAllocations(req: Request, res: Response) {
    const summary = await walletService.getWalletSummary(req.user!.id);
    const list = summary.stationAllocations.map((a) => ({
      id: a.stationId,
      stationId: a.stationId,
      station_id: a.stationId,
      stationName: a.stationName,
      station_name: a.stationName,
      amount: a.ledgerBalance,
      allocatedAmount: a.ledgerBalance,
      availableAmount: a.availableBalance,
      available_amount: a.availableBalance,
      reservedAmount: a.activeHolds,
      status: "ACTIVE",
    }));
    return sendSuccess(res, list, 200);
  }

  async approveTopUp(req: Request, res: Response) {
    const transactionId = req.params.transactionId as string;
    const { body } = getValidatedData<typeof approveTopUpSchema._output>(res);

    const updated = await walletService.approveTopUp(
      req.user!.id,
      transactionId,
      {
        actualReceivedAmount: body.actualReceivedAmount,
        resolutionNote: body.resolutionNote ?? body.verified_bank_reference,
      },
    );

    return sendSuccess(res, updated, 200);
  }

  async rejectTopUp(req: Request, res: Response) {
    const transactionId = req.params.transactionId as string;
    const { body } = getValidatedData<typeof rejectTopUpSchema._output>(res);

    const updated = await walletService.rejectTopUp(
      req.user!.id,
      transactionId,
      body.reason,
    );

    return sendSuccess(res, updated, 200);
  }

  async createAllocation(req: Request, res: Response) {
    const idempotencyKey = req.header("Idempotency-Key");
    if (!idempotencyKey) {
      throw new BadRequestError("Idempotency-Key header is required for allocation");
    }

    const { body } = getValidatedData<typeof allocationSchema._output>(res);
    const transaction = await walletService.createAllocation(
      req.user!.id,
      body,
      idempotencyKey,
    );

    return sendSuccess(res, transaction, 201);
  }

  async createDeallocation(req: Request, res: Response) {
    const idempotencyKey = req.header("Idempotency-Key");
    if (!idempotencyKey) {
      throw new BadRequestError("Idempotency-Key header is required for deallocation");
    }

    const { body } = getValidatedData<typeof deallocationSchema._output>(res);
    const transaction = await walletService.createDeallocation(
      req.user!.id,
      body,
      idempotencyKey,
    );

    return sendSuccess(res, transaction, 201);
  }

  async createTransfer(req: Request, res: Response) {
    const idempotencyKey = req.header("Idempotency-Key");
    if (!idempotencyKey) {
      throw new BadRequestError("Idempotency-Key header is required for transfer");
    }

    const { body } = getValidatedData<typeof transferAllocationSchema._output>(res);
    const transaction = await walletService.createTransfer(
      req.user!.id,
      body,
      idempotencyKey,
    );

    return sendSuccess(res, transaction, 201);
  }
}

export const walletController = new WalletController();

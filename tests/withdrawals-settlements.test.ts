import express from "express";
import session from "express-session";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import { authService } from "../src/modules/auth/auth.service.js";
import type { AuthenticatedUser } from "../src/modules/auth/auth.types.js";
import { adminSettlementsRouter } from "../src/modules/settlements/settlements.routes.js";
import { settlementsService } from "../src/modules/settlements/settlements.service.js";
import {
  adminWithdrawalsRouter,
  walletWithdrawalsRouter,
} from "../src/modules/withdrawals/withdrawals.routes.js";
import { withdrawalsService } from "../src/modules/withdrawals/withdrawals.service.js";
import { UnprocessableContentError } from "../src/shared/errors/app-error.js";

describe("Phase 8: Withdrawals & Settlements", () => {
  const driverUser: AuthenticatedUser = {
    id: "driver-uuid-1",
    fullName: "Driver Ahmed",
    phone: "+249911111111",
    systemRole: "USER",
    status: "ACTIVE",
  };

  const adminUser: AuthenticatedUser = {
    id: "admin-uuid-1",
    fullName: "Platform Admin",
    phone: "+249922222222",
    systemRole: "ADMIN",
    status: "ACTIVE",
  };

  const validBankAccountId = "11111111-1111-4111-8111-111111111111";
  const validStationId = "22222222-2222-4222-8222-222222222222";

  function createTestApp(user: AuthenticatedUser) {
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use(
      session({
        secret: "test-secret-at-least-32-chars-long-for-testing",
        resave: false,
        saveUninitialized: false,
      }),
    );

    app.use((req, _res, next) => {
      req.session.userId = user.id;
      next();
    });

    vi.spyOn(authService, "getUserById").mockImplementation(async (id: string) => {
      if (id === user.id) return user;
      return null;
    });

    app.use("/api/v1/wallet/withdrawals", walletWithdrawalsRouter);
    app.use("/api/v1/admin/withdrawals", adminWithdrawalsRouter);
    app.use("/api/v1/admin/settlements", adminSettlementsRouter);
    app.use(errorHandler);

    return app;
  }

  describe("Withdrawal Requests", () => {
    it("requires Idempotency-Key header on withdrawal creation", async () => {
      const app = createTestApp(driverUser);

      const res = await request(app)
        .post("/api/v1/wallet/withdrawals")
        .send({
          bankAccountId: validBankAccountId,
          requestedAmount: "15000.00",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("Idempotency-Key");
    });

    it("creates PENDING withdrawal with full hold and no ledger entries", async () => {
      const withdrawalTx = {
        id: "tx-w-1",
        transactionType: "WITHDRAWAL",
        status: "PENDING",
        executionStatus: "NOT_STARTED",
        requestedAmount: "15000.00",
        amount: null,
        holdAmount: "15000.00",
        capturedAmount: "0.00",
        releasedAmount: "0.00",
      };

      vi.spyOn(withdrawalsService, "createWithdrawalRequest").mockResolvedValue(withdrawalTx as any);

      const app = createTestApp(driverUser);
      const res = await request(app)
        .post("/api/v1/wallet/withdrawals")
        .set("Idempotency-Key", "idemp-w-1")
        .send({
          bankAccountId: validBankAccountId,
          requestedAmount: "15000.00",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("PENDING");
      expect(res.body.data.holdAmount).toBe("15000.00");
      expect(res.body.data.amount).toBeNull();
    });

    it("rejects withdrawal if user available balance is insufficient", async () => {
      vi.spyOn(withdrawalsService, "createWithdrawalRequest").mockRejectedValue(
        new UnprocessableContentError("Insufficient spendable available balance"),
      );

      const app = createTestApp(driverUser);
      const res = await request(app)
        .post("/api/v1/wallet/withdrawals")
        .set("Idempotency-Key", "idemp-w-2")
        .send({
          bankAccountId: validBankAccountId,
          requestedAmount: "500000.00",
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("UNPROCESSABLE_CONTENT");
    });
  });

  describe("Admin Outgoing Transfer Execution & Reconciliation", () => {
    it("allows ADMIN to approve withdrawal and reserve platform cash commitment", async () => {
      const processingTx = {
        id: "tx-w-1",
        status: "PROCESSING",
        executionStatus: "IN_PROGRESS",
      };

      vi.spyOn(withdrawalsService, "approveWithdrawal").mockResolvedValue(processingTx as any);

      const app = createTestApp(adminUser);
      const res = await request(app).post("/api/v1/admin/withdrawals/tx-w-1/approve");

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("PROCESSING");
      expect(res.body.data.executionStatus).toBe("IN_PROGRESS");
    });

    it("confirms withdrawal success, captures hold, and completes ledger posting", async () => {
      const completedTx = {
        id: "tx-w-1",
        status: "COMPLETED",
        executionStatus: "SUCCEEDED",
        amount: "15000.00",
        capturedAmount: "15000.00",
        releasedAmount: "0.00",
        outgoingBankReference: "BANK-OUT-REF-100",
      };

      vi.spyOn(withdrawalsService, "confirmWithdrawalSuccess").mockResolvedValue(completedTx as any);

      const app = createTestApp(adminUser);
      const res = await request(app)
        .post("/api/v1/admin/withdrawals/tx-w-1/confirm-success")
        .send({
          actualAmount: "15000.00",
          outgoingBankReference: "BANK-OUT-REF-100",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("COMPLETED");
      expect(res.body.data.capturedAmount).toBe("15000.00");
    });

    it("confirms withdrawal failure only after verifying transfer did not occur, releasing hold", async () => {
      const failedTx = {
        id: "tx-w-1",
        status: "FAILED",
        executionStatus: "FAILED",
        capturedAmount: "0.00",
        releasedAmount: "15000.00",
      };

      vi.spyOn(withdrawalsService, "confirmWithdrawalFailure").mockResolvedValue(failedTx as any);

      const app = createTestApp(adminUser);
      const res = await request(app)
        .post("/api/v1/admin/withdrawals/tx-w-1/confirm-failure")
        .send({
          reason: "Bank returned invalid account number error",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("FAILED");
      expect(res.body.data.releasedAmount).toBe("15000.00");
    });
  });

  describe("Settlement Workflow", () => {
    it("rejects settlement when requested amount is below station minimum threshold", async () => {
      vi.spyOn(settlementsService, "createSettlementRequest").mockRejectedValue(
        new UnprocessableContentError("Requested settlement amount is below station minimum settlement threshold"),
      );

      const app = createTestApp(adminUser);
      const res = await request(app)
        .post("/api/v1/admin/settlements")
        .set("Idempotency-Key", "idemp-set-1")
        .send({
          stationId: validStationId,
          bankAccountId: validBankAccountId,
          requestedAmount: "5000.00",
        });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toContain("minimum");
    });

    it("successfully creates settlement request with hold on STATION_PAYABLE", async () => {
      const settlementTx = {
        id: "tx-set-1",
        transactionType: "SETTLEMENT",
        status: "PENDING",
        executionStatus: "NOT_STARTED",
        requestedAmount: "50000.00",
        amount: null,
        holdAmount: "50000.00",
      };

      vi.spyOn(settlementsService, "createSettlementRequest").mockResolvedValue(settlementTx as any);

      const app = createTestApp(adminUser);
      const res = await request(app)
        .post("/api/v1/admin/settlements")
        .set("Idempotency-Key", "idemp-set-2")
        .send({
          stationId: validStationId,
          bankAccountId: validBankAccountId,
          requestedAmount: "50000.00",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.transactionType).toBe("SETTLEMENT");
      expect(res.body.data.holdAmount).toBe("50000.00");
    });

    it("confirms settlement success with outgoing bank reference and captures hold", async () => {
      const completedSetTx = {
        id: "tx-set-1",
        status: "COMPLETED",
        executionStatus: "SUCCEEDED",
        amount: "50000.00",
        capturedAmount: "50000.00",
        releasedAmount: "0.00",
        outgoingBankReference: "SETTLE-OUT-999",
      };

      vi.spyOn(settlementsService, "confirmSettlementSuccess").mockResolvedValue(completedSetTx as any);

      const app = createTestApp(adminUser);
      const res = await request(app)
        .post("/api/v1/admin/settlements/tx-set-1/confirm-success")
        .send({
          actualAmount: "50000.00",
          outgoingBankReference: "SETTLE-OUT-999",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("COMPLETED");
      expect(res.body.data.capturedAmount).toBe("50000.00");
    });
  });
});

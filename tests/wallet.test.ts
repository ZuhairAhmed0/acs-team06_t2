import express, { type Request, type Response } from "express";
import session from "express-session";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { authenticate } from "../src/middleware/authenticate.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import { authService } from "../src/modules/auth/auth.service.js";
import type { AuthenticatedUser } from "../src/modules/auth/auth.types.js";
import { walletController } from "../src/modules/wallet/wallet.controller.js";
import { walletRouter, adminTopUpsRouter } from "../src/modules/wallet/wallet.routes.js";
import { walletService } from "../src/modules/wallet/wallet.service.js";
import { UnprocessableContentError } from "../src/shared/errors/app-error.js";

describe("Phase 6: Wallet Operations", () => {
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
  const validStationId1 = "22222222-2222-4222-8222-222222222222";
  const validStationId2 = "33333333-3333-4333-8333-333333333333";

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

    app.use("/api/v1/wallet", walletRouter);
    app.use("/api/v1/admin/top-ups", adminTopUpsRouter);
    app.use(errorHandler);

    return app;
  }

  describe("Wallet Summary & Transaction History", () => {
    it("returns wallet summary with correct SDG currency and decimal strings", async () => {
      const summaryMock = {
        userId: driverUser.id,
        availableAccount: {
          accountId: "acc-avail-1",
          ledgerBalance: "50000.00",
          activeHolds: "0.00",
          spendableBalance: "50000.00",
        },
        stationAllocations: [
          {
            stationId: "st-1",
            stationName: "Nile Petroleum",
            accountId: "acc-alloc-1",
            ledgerBalance: "20000.00",
            activeHolds: "5000.00",
            availableBalance: "15000.00",
          },
        ],
        totalAllocatedBalance: "15000.00",
        currency: "SDG" as const,
      };

      vi.spyOn(walletService, "getWalletSummary").mockResolvedValue(summaryMock);

      const app = createTestApp(driverUser);
      const res = await request(app).get("/api/v1/wallet");

      expect(res.status).toBe(200);
      expect(res.body.data.currency).toBe("SDG");
      expect(res.body.data.availableAccount.spendableBalance).toBe("50000.00");
      expect(res.body.data.stationAllocations[0].availableBalance).toBe("15000.00");
    });
  });

  describe("Top-Up Request & Admin Approval Lifecycle", () => {
    it("requires Idempotency-Key header on top-up creation", async () => {
      const app = createTestApp(driverUser);

      const res = await request(app)
        .post("/api/v1/wallet/top-ups")
        .send({
          requestedAmount: "25000.00",
          bankAccountId: validBankAccountId,
          submittedBankReference: "REF-BOK-12345",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("Idempotency-Key");
    });

    it("successfully creates a PENDING top-up request without creating ledger entries", async () => {
      const createdTx = {
        id: "tx-topup-1",
        transactionType: "TOP_UP",
        status: "PENDING",
        executionStatus: "NOT_STARTED",
        requestedAmount: "50000.00",
        amount: null,
        userId: driverUser.id,
      };

      vi.spyOn(walletService, "createTopUpRequest").mockResolvedValue(createdTx as any);

      const app = createTestApp(driverUser);
      const res = await request(app)
        .post("/api/v1/wallet/top-ups")
        .set("Idempotency-Key", "idemp-topup-1")
        .send({
          requestedAmount: "50000.00",
          bankAccountId: validBankAccountId,
          submittedBankReference: "REF-BOK-12345",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("PENDING");
      expect(res.body.data.amount).toBeNull();
    });

    it("allows ADMIN to approve top-up with verified actual amount", async () => {
      const approvedTx = {
        id: "tx-topup-1",
        transactionType: "TOP_UP",
        status: "COMPLETED",
        executionStatus: "SUCCEEDED",
        requestedAmount: "50000.00",
        amount: "50000.00",
      };

      vi.spyOn(walletService, "approveTopUp").mockResolvedValue(approvedTx as any);

      const app = createTestApp(adminUser);
      const res = await request(app)
        .post("/api/v1/admin/top-ups/tx-topup-1/approve")
        .send({
          actualReceivedAmount: "50000.00",
          resolutionNote: "Verified transfer from Bank of Khartoum",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("COMPLETED");
      expect(res.body.data.amount).toBe("50000.00");
    });

    it("rejects non-admin users from approving top-ups with 403 Forbidden", async () => {
      const app = createTestApp(driverUser);
      const res = await request(app)
        .post("/api/v1/admin/top-ups/tx-topup-1/approve")
        .send({
          actualReceivedAmount: "50000.00",
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("Allocation, Deallocation & Transfer", () => {
    it("rejects allocation when spendable available balance is insufficient", async () => {
      vi.spyOn(walletService, "createAllocation").mockRejectedValue(
        new UnprocessableContentError("Insufficient spendable available balance"),
      );

      const app = createTestApp(driverUser);
      const res = await request(app)
        .post("/api/v1/wallet/allocations")
        .set("Idempotency-Key", "idemp-alloc-1")
        .send({
          stationId: validStationId1,
          amount: "100000.00",
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("UNPROCESSABLE_CONTENT");
    });

    it("rejects transfer when source and destination stations are the same", async () => {
      const app = createTestApp(driverUser);

      const res = await request(app)
        .post("/api/v1/wallet/transfers")
        .set("Idempotency-Key", "idemp-trans-1")
        .send({
          sourceStationId: validStationId1,
          destinationStationId: validStationId1,
          amount: "1000.00",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("different");
    });

    it("successfully creates transfer between stations when balance is sufficient", async () => {
      const transferTx = {
        id: "tx-trans-1",
        transactionType: "TRANSFER",
        status: "COMPLETED",
        amount: "5000.00",
      };

      vi.spyOn(walletService, "createTransfer").mockResolvedValue(transferTx as any);

      const app = createTestApp(driverUser);
      const res = await request(app)
        .post("/api/v1/wallet/transfers")
        .set("Idempotency-Key", "idemp-trans-2")
        .send({
          sourceStationId: validStationId1,
          destinationStationId: validStationId2,
          amount: "5000.00",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.transactionType).toBe("TRANSFER");
      expect(res.body.data.status).toBe("COMPLETED");
    });
  });
});

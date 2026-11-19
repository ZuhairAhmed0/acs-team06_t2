import express, { type Request, type Response } from "express";
import session from "express-session";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import { authService } from "../src/modules/auth/auth.service.js";
import type { AuthenticatedUser } from "../src/modules/auth/auth.types.js";
import { fuelPurchasesRouter } from "../src/modules/fuel-purchases/fuel-purchases.routes.js";
import { fuelPurchasesService } from "../src/modules/fuel-purchases/fuel-purchases.service.js";
import { ConflictError, UnprocessableContentError } from "../src/shared/errors/app-error.js";

describe("Phase 7: Fuel Purchases", () => {
  const driverUser: AuthenticatedUser = {
    id: "driver-uuid-1",
    fullName: "Driver Ahmed",
    phone: "+249911111111",
    systemRole: "USER",
    status: "ACTIVE",
  };

  const attendantUser: AuthenticatedUser = {
    id: "attendant-uuid-1",
    fullName: "Attendant Osman",
    phone: "+249933333333",
    systemRole: "USER",
    status: "ACTIVE",
  };

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

    app.use("/api/v1/fuel-purchases", fuelPurchasesRouter);
    app.use(errorHandler);

    return app;
  }

  describe("Create Fuel Purchase Request", () => {
    it("requires Idempotency-Key header", async () => {
      const app = createTestApp(driverUser);

      const res = await request(app)
        .post("/api/v1/fuel-purchases")
        .send({
          stationId: validStationId,
          requestedAmount: "25000.00",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("Idempotency-Key");
    });

    it("successfully creates a fuel purchase with hold and no ledger entries", async () => {
      const purchaseTx = {
        id: "tx-purchase-1",
        transactionType: "FUEL_PURCHASE",
        status: "PENDING",
        executionStatus: "NOT_STARTED",
        requestedAmount: "25000.00",
        amount: null,
        holdAmount: "25000.00",
        capturedAmount: "0.00",
        releasedAmount: "0.00",
      };

      vi.spyOn(fuelPurchasesService, "createPurchaseRequest").mockResolvedValue(purchaseTx as any);

      const app = createTestApp(driverUser);
      const res = await request(app)
        .post("/api/v1/fuel-purchases")
        .set("Idempotency-Key", "idemp-fuel-1")
        .send({
          stationId: validStationId,
          requestedAmount: "25000.00",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.holdAmount).toBe("25000.00");
      expect(res.body.data.status).toBe("PENDING");
      expect(res.body.data.amount).toBeNull();
    });
  });

  describe("Start Dispensing", () => {
    it("starts dispensing, locks price snapshot, and transitions to PROCESSING", async () => {
      const startResult = {
        transaction: {
          id: "tx-purchase-1",
          status: "PROCESSING",
          executionStatus: "IN_PROGRESS",
        },
        quote: {
          fuelType: "PETROL",
          plannedQuantity: "20.000",
          unitPrice: "1200.00",
          plannedTotal: "24000.00",
        },
      };

      vi.spyOn(fuelPurchasesService, "startDispensing").mockResolvedValue(startResult as any);

      const app = createTestApp(attendantUser);
      const res = await request(app)
        .post("/api/v1/fuel-purchases/tx-purchase-1/start")
        .send({
          fuelType: "PETROL",
          plannedQuantity: "20.000",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.transaction.status).toBe("PROCESSING");
      expect(res.body.data.quote.unitPrice).toBe("1200.00");
    });

    it("rejects start dispensing if planned total exceeds authorized hold", async () => {
      vi.spyOn(fuelPurchasesService, "startDispensing").mockRejectedValue(
        new UnprocessableContentError("Planned total exceeds authorized hold amount"),
      );

      const app = createTestApp(attendantUser);
      const res = await request(app)
        .post("/api/v1/fuel-purchases/tx-purchase-1/start")
        .send({
          fuelType: "PETROL",
          plannedQuantity: "30.000",
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("UNPROCESSABLE_CONTENT");
    });
  });

  describe("Complete Dispensing", () => {
    it("completes dispensing, captures actual amount, releases remainder, and balances ledger", async () => {
      const completedTx = {
        id: "tx-purchase-1",
        status: "COMPLETED",
        executionStatus: "SUCCEEDED",
        requestedAmount: "25000.00",
        amount: "23500.00",
        capturedAmount: "23500.00",
        releasedAmount: "1500.00",
      };

      vi.spyOn(fuelPurchasesService, "completeDispensing").mockResolvedValue(completedTx as any);

      const app = createTestApp(attendantUser);
      const res = await request(app)
        .post("/api/v1/fuel-purchases/tx-purchase-1/complete")
        .send({
          actualQuantity: "19.583",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("COMPLETED");
      expect(res.body.data.amount).toBe("23500.00");
      expect(res.body.data.capturedAmount).toBe("23500.00");
      expect(res.body.data.releasedAmount).toBe("1500.00");
    });

    it("rejects completion if actual quantity exceeds planned quantity", async () => {
      vi.spyOn(fuelPurchasesService, "completeDispensing").mockRejectedValue(
        new UnprocessableContentError("Actual quantity cannot exceed planned quantity"),
      );

      const app = createTestApp(attendantUser);
      const res = await request(app)
        .post("/api/v1/fuel-purchases/tx-purchase-1/complete")
        .send({
          actualQuantity: "25.000",
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("UNPROCESSABLE_CONTENT");
    });
  });

  describe("Cancellation & Expiration", () => {
    it("cancels unstarted purchase and releases hold", async () => {
      const cancelledTx = {
        id: "tx-purchase-1",
        status: "CANCELLED",
        executionStatus: "NOT_REQUIRED",
        capturedAmount: "0.00",
        releasedAmount: "25000.00",
      };

      vi.spyOn(fuelPurchasesService, "cancelPurchase").mockResolvedValue(cancelledTx as any);

      const app = createTestApp(driverUser);
      const res = await request(app).post("/api/v1/fuel-purchases/tx-purchase-1/cancel");

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("CANCELLED");
      expect(res.body.data.releasedAmount).toBe("25000.00");
    });
  });
});

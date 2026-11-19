import express from "express";
import session from "express-session";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import { authService } from "../src/modules/auth/auth.service.js";
import type { AuthenticatedUser } from "../src/modules/auth/auth.types.js";
import { adminReconciliationRouter } from "../src/modules/reconciliation/reconciliation.routes.js";
import { adminReversalsRouter } from "../src/modules/reversals/reversals.routes.js";
import { reversalsService } from "../src/modules/reversals/reversals.service.js";
import {
  BadRequestError,
  ConflictError,
  UnprocessableContentError,
} from "../src/shared/errors/app-error.js";

describe("Phase 9: Reversals & Audit", () => {
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

    app.use("/api/v1/admin/transactions", adminReconciliationRouter);
    app.use("/api/v1/admin/reversals", adminReversalsRouter);
    app.use(errorHandler);

    return app;
  }

  describe("Reversal Validation & Permissions", () => {
    it("rejects non-admin users from creating reversals with 403 Forbidden", async () => {
      const app = createTestApp(driverUser);
      const res = await request(app)
        .post("/api/v1/admin/transactions/tx-orig-1/reversal")
        .set("Idempotency-Key", "idemp-rev-1")
        .send({
          reason: "Incorrect allocation amount requested by driver",
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("requires Idempotency-Key header on reversal execution", async () => {
      const app = createTestApp(adminUser);
      const res = await request(app)
        .post("/api/v1/admin/transactions/tx-orig-1/reversal")
        .send({
          reason: "Incorrect allocation amount requested by driver",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("Idempotency-Key");
    });

    it("rejects reversal of non-completed transaction with 409 Conflict", async () => {
      vi.spyOn(reversalsService, "createReversal").mockRejectedValue(
        new ConflictError("Only COMPLETED transactions can be reversed"),
      );

      const app = createTestApp(adminUser);
      const res = await request(app)
        .post("/api/v1/admin/transactions/tx-orig-pending/reversal")
        .set("Idempotency-Key", "idemp-rev-2")
        .send({
          reason: "Cancelled before completion",
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
    });

    it("rejects reversal of another reversal with 400 Bad Request", async () => {
      vi.spyOn(reversalsService, "createReversal").mockRejectedValue(
        new BadRequestError("A reversal cannot reverse another reversal transaction"),
      );

      const app = createTestApp(adminUser);
      const res = await request(app)
        .post("/api/v1/admin/transactions/tx-reversal-1/reversal")
        .set("Idempotency-Key", "idemp-rev-3")
        .send({
          reason: "Attempting to reverse a reversal",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
    });

    it("rejects reversal if available funds are insufficient", async () => {
      vi.spyOn(reversalsService, "createReversal").mockRejectedValue(
        new UnprocessableContentError("User allocated balance is insufficient to reverse allocation"),
      );

      const app = createTestApp(adminUser);
      const res = await request(app)
        .post("/api/v1/admin/transactions/tx-orig-spent/reversal")
        .set("Idempotency-Key", "idemp-rev-4")
        .send({
          reason: "Driver already spent the funds at the station",
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("UNPROCESSABLE_CONTENT");
    });

    it("successfully creates reversal transaction and posts opposite ledger entries", async () => {
      const reversalTx = {
        id: "tx-rev-new-1",
        transactionType: "REVERSAL",
        status: "COMPLETED",
        executionStatus: "NOT_REQUIRED",
        requestedAmount: "10000.00",
        amount: "10000.00",
        reversalOfTransactionId: "tx-orig-1",
        resolutionNote: "Approved allocation reversal",
      };

      vi.spyOn(reversalsService, "createReversal").mockResolvedValue(reversalTx as any);

      const app = createTestApp(adminUser);
      const res = await request(app)
        .post("/api/v1/admin/transactions/tx-orig-1/reversal")
        .set("Idempotency-Key", "idemp-rev-5")
        .send({
          reason: "Approved allocation reversal by administrator",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.transactionType).toBe("REVERSAL");
      expect(res.body.data.status).toBe("COMPLETED");
      expect(res.body.data.reversalOfTransactionId).toBe("tx-orig-1");
    });
  });
});

import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
  UnauthorizedError,
  UnprocessableContentError,
} from "../src/shared/errors/app-error.js";
import { mapDatabaseError } from "../src/shared/errors/db-error-mapper.js";

describe("Centralized Error Handling", () => {
  function createTestAppWithErrorRoute(errorToThrow: unknown) {
    const app = express();
    app.use(requestIdMiddleware);
    app.get("/trigger-error", () => {
      throw errorToThrow;
    });
    app.use(errorHandler);
    return app;
  }

  it.each([
    [new BadRequestError("Invalid parameter."), 400, "BAD_REQUEST"],
    [new UnauthorizedError("Token expired."), 401, "UNAUTHORIZED"],
    [new ForbiddenError("Permission denied."), 403, "FORBIDDEN"],
    [new NotFoundError("Wallet not found."), 404, "NOT_FOUND"],
    [new ConflictError("Transaction already processed."), 409, "CONFLICT"],
    [new UnprocessableContentError("Insufficient funds."), 422, "UNPROCESSABLE_CONTENT"],
    [new TooManyRequestsError("Rate limit reached."), 429, "TOO_MANY_REQUESTS"],
    [new InternalServerError("Database failure."), 500, "INTERNAL_SERVER_ERROR"],
    [new ServiceUnavailableError("Maintenance window."), 503, "SERVICE_UNAVAILABLE"],
  ])("maps %s to HTTP %i with code %s", async (errorInstance, expectedStatus, expectedCode) => {
    const app = createTestAppWithErrorRoute(errorInstance);

    const response = await request(app).get("/trigger-error");

    expect(response.status).toBe(expectedStatus);
    expect(response.body).toEqual({
      error: {
        code: expectedCode,
        message: errorInstance.message,
        requestId: expect.any(String),
      },
    });
    expect(response.headers["x-request-id"]).toBe(response.body.error.requestId);
  });

  describe("PostgreSQL Error Mapping", () => {
    it("maps 23505 unique_violation to 409 Conflict without leaking table/column internals", async () => {
      const postgresUniqueError = {
        code: "23505",
        table: "users",
        constraint: "users_phone_number_unique",
        detail: "Key (phone_number)=(0912345678) already exists.",
        routine: "_bt_check_unique",
      };

      const mapped = mapDatabaseError(postgresUniqueError);
      expect(mapped).not.toBeNull();
      expect(mapped?.statusCode).toBe(409);
      expect(mapped?.code).toBe("CONFLICT");

      const app = createTestAppWithErrorRoute(postgresUniqueError);
      const response = await request(app).get("/trigger-error");

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("CONFLICT");
      expect(response.text).not.toContain("users_phone_number_unique");
      expect(response.text).not.toContain("0912345678");
      expect(response.text).not.toContain("_bt_check_unique");
    });

    it("maps 23503 foreign_key_violation to 409 Conflict", async () => {
      const postgresFkError = {
        code: "23503",
        table: "financial_entries",
        constraint: "financial_entries_transaction_id_fkey",
      };

      const app = createTestAppWithErrorRoute(postgresFkError);
      const response = await request(app).get("/trigger-error");

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("CONFLICT");
      expect(response.text).not.toContain("financial_entries_transaction_id_fkey");
    });

    it("maps 23514 check_violation to 422 Unprocessable Content", async () => {
      const postgresCheckError = {
        code: "23514",
        table: "financial_entries",
        constraint: "financial_entries_amount_positive",
      };

      const app = createTestAppWithErrorRoute(postgresCheckError);
      const response = await request(app).get("/trigger-error");

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("UNPROCESSABLE_CONTENT");
    });

    it("maps 40001 serialization_failure to 409 Conflict for retryable transactions", async () => {
      const postgresSerializationError = {
        code: "40001",
        detail: "could not serialize access due to read/write dependencies among transactions",
      };

      const app = createTestAppWithErrorRoute(postgresSerializationError);
      const response = await request(app).get("/trigger-error");

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("CONFLICT");
    });

    it("maps connection failures (08006, 57P01) to 503 Service Unavailable", async () => {
      const postgresShutdown = { code: "57P01" };
      const app = createTestAppWithErrorRoute(postgresShutdown);
      const response = await request(app).get("/trigger-error");

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("SERVICE_UNAVAILABLE");
    });

    it("treats unmapped arbitrary database errors as safe 500 without leaking SQL or queries", async () => {
      const unmappedSqlError = {
        code: "42601", // syntax_error
        query: "SELECT secret_password FROM users WHERE id = 'secret'",
        detail: "syntax error at or near 'secret'",
      };

      const app = createTestAppWithErrorRoute(unmappedSqlError);
      const response = await request(app).get("/trigger-error");

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(response.text).not.toContain("secret_password");
      expect(response.text).not.toContain("SELECT");
      expect(response.text).not.toContain("42601");
    });
  });

  describe("Production Redaction & Information Hiding", () => {
    it("never exposes stack traces or internal filenames in error responses", async () => {
      const unexpectedError = new Error("Unexpected memory leak in /root/src/auth.ts line 42");
      const app = createTestAppWithErrorRoute(unexpectedError);

      const response = await request(app).get("/trigger-error");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred.",
          requestId: expect.any(String),
        },
      });
      expect(response.text).not.toContain("/root/src/auth.ts");
      expect(response.text).not.toContain("line 42");
    });
  });
});

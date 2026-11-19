import express, { type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import { NotFoundError } from "../src/shared/errors/app-error.js";

describe("Request Correlation & ID Tracking", () => {
  function createApp() {
    const app = express();
    app.use(requestIdMiddleware);
    app.get("/test-id", (req: Request, res: Response) => {
      res.status(200).json({ requestId: req.id, localId: res.locals.requestId });
    });
    app.get("/test-error", () => {
      throw new NotFoundError("Test resource not found.");
    });
    app.use(errorHandler);
    return app;
  }

  const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it("generates a cryptographically secure UUID when none is supplied", async () => {
    const app = createApp();

    const response = await request(app).get("/test-id");

    expect(response.status).toBe(200);
    const headerId = response.headers["x-request-id"];
    expect(headerId).toBeDefined();
    expect(headerId).toMatch(UUID_REGEX);
    expect(response.body.requestId).toBe(headerId);
    expect(response.body.localId).toBe(headerId);
  });

  it("generates distinct IDs for consecutive requests", async () => {
    const app = createApp();

    const res1 = await request(app).get("/test-id");
    const res2 = await request(app).get("/test-id");

    expect(res1.headers["x-request-id"]).not.toBe(res2.headers["x-request-id"]);
  });

  it("preserves a valid client-supplied correlation ID", async () => {
    const app = createApp();
    const validClientCorrelationId = "order-checkout-ref-98765";

    const response = await request(app)
      .get("/test-id")
      .set("X-Request-ID", validClientCorrelationId);

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toBe(validClientCorrelationId);
    expect(response.body.requestId).toBe(validClientCorrelationId);
  });

  it("sanitizes and replaces malformed or malicious client-supplied IDs", async () => {
    const app = createApp();
    const maliciousIds = [
      "bad id with spaces",
      "<script>alert(1)</script>",
      "SELECT * FROM users",
      "short", // under 8 chars
      "a".repeat(100), // over 64 chars
      "../../etc/passwd",
    ];

    for (const badId of maliciousIds) {
      const response = await request(app)
        .get("/test-id")
        .set("X-Request-ID", badId);

      expect(response.status).toBe(200);
      const generatedId = response.headers["x-request-id"];
      expect(generatedId).not.toBe(badId);
      expect(generatedId).toMatch(UUID_REGEX);
    }
  });

  it("includes the request ID in error responses", async () => {
    const app = createApp();

    const response = await request(app).get("/test-error");

    expect(response.status).toBe(404);
    const headerId = response.headers["x-request-id"];
    expect(headerId).toBeDefined();
    expect(response.body.error.requestId).toBe(headerId);
  });
});

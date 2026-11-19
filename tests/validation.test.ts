import express, { type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import {
  getValidatedData,
  validateRequest,
} from "../src/middleware/validate-request.js";

describe("Request Validation Middleware", () => {
  function createTestApp() {
    const app = express();
    app.use(requestIdMiddleware);
    app.use(express.json());
    return app;
  }

  const sampleBodySchema = z.object({
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
    description: z.string().min(3),
  });

  const sampleParamsSchema = z.object({
    stationId: z.string().uuid(),
  });

  const sampleQuerySchema = z.object({
    limit: z.coerce.number().int().positive().max(100),
  });

  it("passes when valid body is supplied and preserves validated data", async () => {
    const app = createTestApp();
    const controllerSpy = vi.fn((_req: Request, res: Response) => {
      const validated = getValidatedData<z.infer<typeof sampleBodySchema>>(res);
      res.status(200).json({ data: validated.body });
    });

    app.post(
      "/test-validation",
      validateRequest({ body: sampleBodySchema }),
      controllerSpy,
    );
    app.use(errorHandler);

    const validPayload = { amount: "150.50", description: "Fuel Topup" };
    const response = await request(app)
      .post("/test-validation")
      .send(validPayload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: validPayload });
    expect(controllerSpy).toHaveBeenCalledOnce();
  });

  it("rejects invalid body before controller executes with consistent error structure", async () => {
    const app = createTestApp();
    const controllerSpy = vi.fn((_req: Request, res: Response) => {
      res.status(200).json({ data: "should not be reached" });
    });

    app.post(
      "/test-validation",
      validateRequest({ body: sampleBodySchema }),
      controllerSpy,
    );
    app.use(errorHandler);

    const invalidPayload = { amount: "not-a-number", description: "x" };
    const response = await request(app)
      .post("/test-validation")
      .send(invalidPayload);

    expect(response.status).toBe(400);
    expect(controllerSpy).not.toHaveBeenCalled();
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: expect.stringContaining("Validation failed: body."),
        requestId: expect.any(String),
      },
    });
    // Ensure no stack traces or internal paths are exposed
    expect(response.text).not.toContain("node_modules");
    expect(response.text).not.toContain("Error:");
  });

  it("rejects invalid route parameters before controller executes", async () => {
    const app = createTestApp();
    const controllerSpy = vi.fn();

    app.get(
      "/stations/:stationId",
      validateRequest({ params: sampleParamsSchema }),
      controllerSpy,
    );
    app.use(errorHandler);

    const response = await request(app).get("/stations/not-a-valid-uuid");

    expect(response.status).toBe(400);
    expect(controllerSpy).not.toHaveBeenCalled();
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: expect.stringContaining("Validation failed: params.stationId"),
        requestId: expect.any(String),
      },
    });
  });

  it("passes when valid route parameter is provided", async () => {
    const app = createTestApp();
    const validUuid = "123e4567-e89b-12d3-a456-426614174000";

    app.get(
      "/stations/:stationId",
      validateRequest({ params: sampleParamsSchema }),
      (_req: Request, res: Response) => {
        const validated = getValidatedData<
          unknown,
          z.infer<typeof sampleParamsSchema>
        >(res);
        res.status(200).json({ stationId: validated.params.stationId });
      },
    );
    app.use(errorHandler);

    const response = await request(app).get(`/stations/${validUuid}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ stationId: validUuid });
  });

  it("rejects invalid query parameters before controller executes", async () => {
    const app = createTestApp();
    const controllerSpy = vi.fn();

    app.get(
      "/items",
      validateRequest({ query: sampleQuerySchema }),
      controllerSpy,
    );
    app.use(errorHandler);

    const response = await request(app).get("/items?limit=invalid_number");

    expect(response.status).toBe(400);
    expect(controllerSpy).not.toHaveBeenCalled();
    expect(response.body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: expect.stringContaining("Validation failed: query.limit"),
        requestId: expect.any(String),
      },
    });
  });

  it("validates combined body, params, and query simultaneously", async () => {
    const app = createTestApp();
    const validUuid = "123e4567-e89b-12d3-a456-426614174000";

    app.put(
      "/stations/:stationId/fuel",
      validateRequest({
        params: sampleParamsSchema,
        query: sampleQuerySchema,
        body: sampleBodySchema,
      }),
      (_req: Request, res: Response) => {
        const validated = getValidatedData<
          z.infer<typeof sampleBodySchema>,
          z.infer<typeof sampleParamsSchema>,
          z.infer<typeof sampleQuerySchema>
        >(res);
        res.status(200).json({
          stationId: validated.params.stationId,
          limit: validated.query.limit,
          amount: validated.body.amount,
        });
      },
    );
    app.use(errorHandler);

    const response = await request(app)
      .put(`/stations/${validUuid}/fuel?limit=50`)
      .send({ amount: "200.00", description: "Regular 91" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      stationId: validUuid,
      limit: 50,
      amount: "200.00",
    });
  });
});

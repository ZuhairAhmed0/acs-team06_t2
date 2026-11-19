import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

describe("health endpoints", () => {
  it("returns a successful liveness response", async () => {
    const app = createApp({ databaseReadinessCheck: async () => {} });

    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toBeDefined();
    expect(response.body).toEqual({
      data: {
        status: "ok",
        service: "where-is-fuel-api",
      },
    });
  });

  it("reports ready when the database readiness check succeeds", async () => {
    const readinessCheck = async (): Promise<void> => {};
    const app = createApp({ databaseReadinessCheck: readinessCheck });

    const response = await request(app).get("/api/v1/ready");

    expect(response.status).toBe(200);
    expect(response.headers["x-request-id"]).toBeDefined();
    expect(response.body).toEqual({
      data: {
        status: "ready",
        service: "where-is-fuel-api",
      },
    });
  });

  it("reports unavailable when the database readiness check fails", async () => {
    const app = createApp({
      databaseReadinessCheck: async () => {
        throw new Error("Database unavailable");
      },
    });

    const response = await request(app).get("/api/v1/ready");

    expect(response.status).toBe(503);
    expect(response.headers["x-request-id"]).toBeDefined();
    expect(response.body).toEqual({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Service is not ready.",
        requestId: expect.any(String),
      },
    });
  });
});

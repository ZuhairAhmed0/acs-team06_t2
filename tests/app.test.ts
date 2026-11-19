import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";

describe("application middleware", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a consistent 404 response for unknown routes", async () => {
    const app = createApp({ databaseReadinessCheck: async () => {} });

    const response = await request(app).get("/api/v1/unknown");

    expect(response.status).toBe(404);
    expect(response.headers["x-request-id"]).toBeDefined();
    expect(response.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route GET /api/v1/unknown was not found.",
        requestId: expect.any(String),
      },
    });
  });

  it("does not expose stack traces for unexpected errors", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const app = createApp({
      databaseReadinessCheck: async () => {},
      registerAdditionalRoutes(application) {
        application.get("/test-error", (_request, _response, next) => {
          next(new Error("Internal test detail"));
        });
      },
    });

    const response = await request(app).get("/test-error");

    expect(response.status).toBe(500);
    expect(response.headers["x-request-id"]).toBeDefined();
    expect(response.body).toEqual({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
        requestId: expect.any(String),
      },
    });
    expect(response.text).not.toContain("Internal test detail");
    expect(response.text).not.toContain("Error:");
  });
});

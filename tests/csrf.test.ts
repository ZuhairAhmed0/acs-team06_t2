import session from "express-session";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

describe("CSRF Protection", () => {
  function createTestApp() {
    const memoryStore = new session.MemoryStore();
    return createApp({ sessionStore: memoryStore });
  }

  it("creates and returns a CSRF token on GET /api/v1/auth/csrf", async () => {
    const app = createTestApp();

    const response = await request(app).get("/api/v1/auth/csrf");

    expect(response.status).toBe(200);
    expect(response.body.data.csrfToken).toBeDefined();
    expect(typeof response.body.data.csrfToken).toBe("string");
    expect(response.body.data.csrfToken.length).toBe(64); // 32 bytes hex
    expect(response.headers["set-cookie"]).toBeDefined();
    expect(response.headers["set-cookie"][0]).toContain("wifuel.sid");
  });

  it("rejects unsafe requests (POST) missing X-CSRF-Token header", async () => {
    const app = createTestApp();

    const csrfRes = await request(app).get("/api/v1/auth/csrf");
    const cookie = csrfRes.headers["set-cookie"];

    const response = await request(app)
      .post("/api/v1/auth/login")
      .set("Cookie", cookie)
      .send({ phone: "+249912345678", password: "Password12345" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(response.body.error.message).toContain("CSRF");
  });

  it("rejects unsafe requests with mismatched X-CSRF-Token header", async () => {
    const app = createTestApp();

    const csrfRes = await request(app).get("/api/v1/auth/csrf");
    const cookie = csrfRes.headers["set-cookie"];

    const response = await request(app)
      .post("/api/v1/auth/login")
      .set("Cookie", cookie)
      .set("X-CSRF-Token", "invalid-csrf-token-that-does-not-match")
      .send({ phone: "+249912345678", password: "Password12345" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("allows safe GET requests without a CSRF token", async () => {
    const app = createTestApp();

    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
  });
});

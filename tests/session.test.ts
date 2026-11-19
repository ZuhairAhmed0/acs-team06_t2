import session from "express-session";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { pool } from "../src/db/client.js";
import {
  createPgSessionStore,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  SESSION_TTL_SECONDS,
} from "../src/middleware/session.js";
import { authService } from "../src/modules/auth/auth.service.js";

describe("Session Management & Security", () => {
  const mockUser = {
    id: "user-session-123",
    fullName: "Session Test User",
    phone: "+249912345678",
    systemRole: "USER" as const,
    status: "ACTIVE" as const,
  };

  function createTestApp(store?: session.Store) {
    return createApp({
      sessionStore: store ?? new session.MemoryStore(),
    });
  }

  describe("Session Store Configuration", () => {
    it("configures connect-pg-simple with existing pool and auth_sessions table", () => {
      const pgStore = createPgSessionStore();

      expect(pgStore).toBeDefined();
      const storeAny = pgStore as any;
      expect(typeof storeAny.quotedTable).toBe("function");
      expect(storeAny.quotedTable()).toBe('"auth_sessions"');
      expect(storeAny.ttl).toBe(SESSION_TTL_SECONDS);
    });
  });

  describe("Session Lifecycle & Cookie Attributes", () => {
    it("persists authenticated session across multiple requests using session cookie", async () => {
      const app = createTestApp();

      // 1. Get CSRF token
      const csrfRes = await request(app).get("/api/v1/auth/csrf");
      const cookie = csrfRes.headers["set-cookie"][0];
      const csrfToken = csrfRes.body.data.csrfToken;

      vi.spyOn(authService, "verifyCredentials").mockResolvedValueOnce(mockUser);
      vi.spyOn(authService, "getUserById").mockResolvedValue(mockUser);

      // 2. Login
      const loginRes = await request(app)
        .post("/api/v1/auth/login")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrfToken)
        .send({ phone: "+249912345678", password: "Password12345" });

      expect(loginRes.status).toBe(200);
      const authCookie = loginRes.headers["set-cookie"][0];
      expect(authCookie).toContain(SESSION_COOKIE_NAME);
      expect(authCookie).toContain("HttpOnly");
      expect(authCookie).toContain("SameSite=Lax");
      expect(authCookie).toContain("Path=/");

      // 3. Authenticated request using authCookie
      const meRes = await request(app)
        .get("/api/v1/users/me")
        .set("Cookie", authCookie);

      expect(meRes.status).toBe(200);
      expect(meRes.body.data.id).toBe(mockUser.id);
      expect(meRes.body.data.phone).toBe(mockUser.phone);
    });

    it("destroys session and clears cookie on logout", async () => {
      const app = createTestApp();

      const csrfRes = await request(app).get("/api/v1/auth/csrf");
      const cookie = csrfRes.headers["set-cookie"][0];
      const csrfToken = csrfRes.body.data.csrfToken;

      vi.spyOn(authService, "verifyCredentials").mockResolvedValueOnce(mockUser);
      vi.spyOn(authService, "getUserById").mockResolvedValue(mockUser);

      const loginRes = await request(app)
        .post("/api/v1/auth/login")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrfToken)
        .send({ phone: "+249912345678", password: "Password12345" });

      const authCookie = loginRes.headers["set-cookie"][0];
      const newCsrf = loginRes.body.data.csrfToken;

      // Logout
      const logoutRes = await request(app)
        .post("/api/v1/auth/logout")
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", newCsrf);

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.data.message).toBe("Logged out successfully.");

      // Check cookie was cleared (Expires in past or Max-Age=0)
      const clearedCookie = logoutRes.headers["set-cookie"][0];
      expect(clearedCookie).toContain(`${SESSION_COOKIE_NAME}=;`);

      // Subsequent /users/me request with old cookie must fail with 401
      const meRes = await request(app)
        .get("/api/v1/users/me")
        .set("Cookie", authCookie);

      expect(meRes.status).toBe(401);
      expect(meRes.body.error.code).toBe("UNAUTHORIZED");
    });

    it("destroys all user sessions on logout-all", async () => {
      const app = createTestApp();

      const csrfRes = await request(app).get("/api/v1/auth/csrf");
      const cookie = csrfRes.headers["set-cookie"][0];
      const csrfToken = csrfRes.body.data.csrfToken;

      vi.spyOn(authService, "verifyCredentials").mockResolvedValueOnce(mockUser);
      vi.spyOn(authService, "getUserById").mockResolvedValue(mockUser);
      const revokeAllSpy = vi
        .spyOn(authService, "revokeAllUserSessions")
        .mockResolvedValueOnce();

      const loginRes = await request(app)
        .post("/api/v1/auth/login")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrfToken)
        .send({ phone: "+249912345678", password: "Password12345" });

      const authCookie = loginRes.headers["set-cookie"][0];
      const newCsrf = loginRes.body.data.csrfToken;

      // Logout all
      const logoutAllRes = await request(app)
        .post("/api/v1/auth/logout-all")
        .set("Cookie", authCookie)
        .set("X-CSRF-Token", newCsrf);

      expect(logoutAllRes.status).toBe(200);
      expect(logoutAllRes.body.data.message).toBe("All sessions terminated successfully.");
      expect(revokeAllSpy).toHaveBeenCalledWith(mockUser.id);

      revokeAllSpy.mockRestore();
    });

    it("fails closed with 503 SERVICE_UNAVAILABLE when database/store throws", async () => {
      const app = createTestApp();

      vi.spyOn(authService, "getUserById").mockRejectedValueOnce(
        new Error("PostgreSQL connection timeout"),
      );

      // Create app with active session
      const testApp = createApp({
        sessionStore: new session.MemoryStore(),
        registerAdditionalRoutes(application) {
          application.get("/test-db-down", (req, _res, next) => {
            req.session.userId = "user-123";
            next();
          });
        },
      });

      const csrfRes = await request(testApp).get("/test-db-down");
      const cookie = csrfRes.headers["set-cookie"][0];

      const response = await request(testApp)
        .get("/api/v1/users/me")
        .set("Cookie", cookie);

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("SERVICE_UNAVAILABLE");
    });
  });
});

import session from "express-session";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { db } from "../src/db/client.js";
import { authService } from "../src/modules/auth/auth.service.js";
import { hashPassword } from "../src/modules/auth/password.js";
import { ConflictError, UnauthorizedError } from "../src/shared/errors/app-error.js";

describe("Authentication API", () => {
  function createTestApp() {
    const memoryStore = new session.MemoryStore();
    return createApp({ sessionStore: memoryStore });
  }

  describe("POST /api/v1/auth/register", () => {
    it("successfully registers a regular USER and never returns password hash", async () => {
      const app = createTestApp();

      const csrfRes = await request(app).get("/api/v1/auth/csrf");
      const cookie = csrfRes.headers["set-cookie"];
      const csrfToken = csrfRes.body.data.csrfToken;

      const registerSpy = vi.spyOn(authService, "registerUser").mockResolvedValueOnce({
        id: "123e4567-e89b-12d3-a456-426614174000",
        fullName: "Ahmed Ali",
        phone: "+249912345678",
        systemRole: "USER",
        status: "ACTIVE",
      });

      const response = await request(app)
        .post("/api/v1/auth/register")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          fullName: "Ahmed Ali",
          phone: "+249 (91) 234-5678", // Unformatted phone
          password: "MySecurePassword123",
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toEqual({
        id: "123e4567-e89b-12d3-a456-426614174000",
        fullName: "Ahmed Ali",
        phone: "+249912345678",
        systemRole: "USER",
        status: "ACTIVE",
      });
      // Ensure password_hash is never returned in response
      expect(response.body.data.passwordHash).toBeUndefined();
      expect(response.body.data.password_hash).toBeUndefined();
      expect(response.text).not.toContain("passwordHash");

      registerSpy.mockRestore();
    });

    it("rejects attempt to register with duplicate phone with 409 Conflict", async () => {
      const app = createTestApp();

      const csrfRes = await request(app).get("/api/v1/auth/csrf");
      const cookie = csrfRes.headers["set-cookie"];
      const csrfToken = csrfRes.body.data.csrfToken;

      const registerSpy = vi.spyOn(authService, "registerUser").mockRejectedValueOnce(
        new ConflictError("An account with this phone number already exists."),
      );

      const response = await request(app)
        .post("/api/v1/auth/register")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          fullName: "Ahmed Ali",
          phone: "+249912345678",
          password: "MySecurePassword123",
        });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("CONFLICT");

      registerSpy.mockRestore();
    });

    it("rejects attempt to register with system_role or systemRole ADMIN", async () => {
      const app = createTestApp();

      const csrfRes = await request(app).get("/api/v1/auth/csrf");
      const cookie = csrfRes.headers["set-cookie"];
      const csrfToken = csrfRes.body.data.csrfToken;

      const response = await request(app)
        .post("/api/v1/auth/register")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          fullName: "Malicious Admin",
          phone: "+249912345678",
          password: "MySecurePassword123",
          systemRole: "ADMIN",
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects invalid phone format", async () => {
      const app = createTestApp();

      const csrfRes = await request(app).get("/api/v1/auth/csrf");
      const cookie = csrfRes.headers["set-cookie"];
      const csrfToken = csrfRes.body.data.csrfToken;

      const response = await request(app)
        .post("/api/v1/auth/register")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          fullName: "Ahmed Ali",
          phone: "not-a-phone",
          password: "MySecurePassword123",
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects password shorter than 12 characters", async () => {
      const app = createTestApp();

      const csrfRes = await request(app).get("/api/v1/auth/csrf");
      const cookie = csrfRes.headers["set-cookie"];
      const csrfToken = csrfRes.body.data.csrfToken;

      const response = await request(app)
        .post("/api/v1/auth/register")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          fullName: "Ahmed Ali",
          phone: "+249912345678",
          password: "short", // Only 5 chars
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects password exceeding 72 UTF-8 bytes", async () => {
      const app = createTestApp();

      const csrfRes = await request(app).get("/api/v1/auth/csrf");
      const cookie = csrfRes.headers["set-cookie"];
      const csrfToken = csrfRes.body.data.csrfToken;

      const longPassword = "A".repeat(75);

      const response = await request(app)
        .post("/api/v1/auth/register")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          fullName: "Ahmed Ali",
          phone: "+249912345678",
          password: longPassword,
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /api/v1/auth/login", () => {
    const mockUser = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      fullName: "Ahmed Ali",
      phone: "+249912345678",
      systemRole: "USER" as const,
      status: "ACTIVE" as const,
    };

    it("successfully logs in, regenerates session ID, sets cookie, and returns NO JWT", async () => {
      const app = createTestApp();

      const csrfRes = await request(app).get("/api/v1/auth/csrf");
      const initialCookie = csrfRes.headers["set-cookie"][0];
      const csrfToken = csrfRes.body.data.csrfToken;

      const verifySpy = vi
        .spyOn(authService, "verifyCredentials")
        .mockResolvedValueOnce(mockUser);

      const response = await request(app)
        .post("/api/v1/auth/login")
        .set("Cookie", initialCookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          phone: "+249912345678",
          password: "ValidPassword123",
        });

      expect(response.status).toBe(200);
      expect(response.body.data.user).toEqual(mockUser);
      expect(response.body.data.csrfToken).toBeDefined();

      // Ensure NO tokens are in the response
      expect(response.body.token).toBeUndefined();
      expect(response.body.accessToken).toBeUndefined();
      expect(response.body.refreshToken).toBeUndefined();
      expect(response.body.jwt).toBeUndefined();

      // Ensure session cookie is returned
      const newCookie = response.headers["set-cookie"][0];
      expect(newCookie).toBeDefined();
      expect(newCookie).toContain("wifuel.sid");
      expect(newCookie).toContain("HttpOnly");

      verifySpy.mockRestore();
    });

    it("returns generic 401 error on invalid credentials", async () => {
      const app = createTestApp();

      const csrfRes = await request(app).get("/api/v1/auth/csrf");
      const cookie = csrfRes.headers["set-cookie"];
      const csrfToken = csrfRes.body.data.csrfToken;

      const verifySpy = vi
        .spyOn(authService, "verifyCredentials")
        .mockRejectedValueOnce(new UnauthorizedError("Invalid phone or password."));

      const response = await request(app)
        .post("/api/v1/auth/login")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          phone: "+249999999999",
          password: "WrongPassword123",
        });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
      expect(response.body.error.message).toBe("Invalid phone or password.");

      verifySpy.mockRestore();
    });

    it("returns 401 when user account is blocked", async () => {
      const app = createTestApp();

      const csrfRes = await request(app).get("/api/v1/auth/csrf");
      const cookie = csrfRes.headers["set-cookie"];
      const csrfToken = csrfRes.body.data.csrfToken;

      const verifySpy = vi
        .spyOn(authService, "verifyCredentials")
        .mockRejectedValueOnce(
          new UnauthorizedError("Account is blocked. Please contact support."),
        );

      const response = await request(app)
        .post("/api/v1/auth/login")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          phone: "+249912345678",
          password: "Password12345",
        });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
      expect(response.body.error.message).toContain("blocked");

      verifySpy.mockRestore();
    });

    it("returns 401 when user account is inactive", async () => {
      const app = createTestApp();

      const csrfRes = await request(app).get("/api/v1/auth/csrf");
      const cookie = csrfRes.headers["set-cookie"];
      const csrfToken = csrfRes.body.data.csrfToken;

      const verifySpy = vi
        .spyOn(authService, "verifyCredentials")
        .mockRejectedValueOnce(new UnauthorizedError("Account is inactive."));

      const response = await request(app)
        .post("/api/v1/auth/login")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", csrfToken)
        .send({
          phone: "+249912345678",
          password: "Password12345",
        });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
      expect(response.body.error.message).toContain("inactive");

      verifySpy.mockRestore();
    });
  });

  describe("AuthService Unit Verification", () => {
    it("verifyCredentials throws generic 401 on unknown phone", async () => {
      const selectSpy = vi.spyOn(db, "select").mockReturnValue({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      } as any);

      await expect(
        authService.verifyCredentials("+249900000000", "ValidPass12345"),
      ).rejects.toThrow("Invalid phone or password.");

      selectSpy.mockRestore();
    });

    it("verifyCredentials throws generic 401 on incorrect password", async () => {
      const realHash = await hashPassword("RealPassword123");

      const selectSpy = vi.spyOn(db, "select").mockReturnValue({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  id: "user-1",
                  fullName: "Test",
                  phone: "+249912345678",
                  passwordHash: realHash,
                  systemRole: "USER",
                  status: "ACTIVE",
                },
              ]),
          }),
        }),
      } as any);

      await expect(
        authService.verifyCredentials("+249912345678", "WrongPassword123"),
      ).rejects.toThrow("Invalid phone or password.");

      selectSpy.mockRestore();
    });

    it("verifyCredentials throws 401 on blocked user", async () => {
      const realHash = await hashPassword("RealPassword123");

      const selectSpy = vi.spyOn(db, "select").mockReturnValue({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  id: "user-1",
                  fullName: "Test",
                  phone: "+249912345678",
                  passwordHash: realHash,
                  systemRole: "USER",
                  status: "BLOCKED",
                },
              ]),
          }),
        }),
      } as any);

      await expect(
        authService.verifyCredentials("+249912345678", "RealPassword123"),
      ).rejects.toThrow("Account is blocked. Please contact support.");

      selectSpy.mockRestore();
    });

    it("verifyCredentials throws 401 on inactive user", async () => {
      const realHash = await hashPassword("RealPassword123");

      const selectSpy = vi.spyOn(db, "select").mockReturnValue({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  id: "user-1",
                  fullName: "Test",
                  phone: "+249912345678",
                  passwordHash: realHash,
                  systemRole: "USER",
                  status: "INACTIVE",
                },
              ]),
          }),
        }),
      } as any);

      await expect(
        authService.verifyCredentials("+249912345678", "RealPassword123"),
      ).rejects.toThrow("Account is inactive.");

      selectSpy.mockRestore();
    });
  });

  describe("GET /api/v1/users/me", () => {
    it("returns 401 when not authenticated", async () => {
      const app = createTestApp();

      const response = await request(app).get("/api/v1/users/me");

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });
  });
});

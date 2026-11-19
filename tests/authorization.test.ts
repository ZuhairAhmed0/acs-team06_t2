import express, { type Request, type Response } from "express";
import session from "express-session";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { db } from "../src/db/client.js";
import { authenticate } from "../src/middleware/authenticate.js";
import {
  requireStationRole,
  requireSystemRole,
} from "../src/middleware/authorize.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import { authService } from "../src/modules/auth/auth.service.js";
import type { AuthenticatedUser } from "../src/modules/auth/auth.types.js";

describe("Role-Based Authorization", () => {
  const adminUser: AuthenticatedUser = {
    id: "admin-uuid-1",
    fullName: "Platform Admin",
    phone: "+249911111111",
    systemRole: "ADMIN",
    status: "ACTIVE",
  };

  const regularUser: AuthenticatedUser = {
    id: "user-uuid-1",
    fullName: "Regular Driver",
    phone: "+249922222222",
    systemRole: "USER",
    status: "ACTIVE",
  };

  function createAuthApp(mockUser: AuthenticatedUser | null) {
    const app = express();
    app.use(requestIdMiddleware);
    app.use(
      session({
        secret: "test-secret-at-least-32-chars-long-for-testing",
        resave: false,
        saveUninitialized: false,
      }),
    );

    // Seed session if mockUser provided
    app.use((req, _res, next) => {
      if (mockUser) {
        req.session.userId = mockUser.id;
      }
      next();
    });

    // Mock authService.getUserById
    vi.spyOn(authService, "getUserById").mockImplementation(async (id: string) => {
      if (mockUser && mockUser.id === id) {
        return mockUser;
      }
      return null;
    });

    // Administrative protected route
    app.get(
      "/admin/dashboard",
      authenticate,
      requireSystemRole("ADMIN"),
      (_req: Request, res: Response) => {
        res.status(200).json({ data: "admin-access-granted" });
      },
    );

    // Station Owner-only route
    app.get(
      "/stations/:stationId/settlements",
      authenticate,
      requireStationRole(["OWNER"]),
      (_req: Request, res: Response) => {
        res.status(200).json({ data: "owner-settlements-granted" });
      },
    );

    // Station Attendant-or-Owner route
    app.get(
      "/stations/:stationId/fuel-dispense",
      authenticate,
      requireStationRole(["OWNER", "ATTENDANT"]),
      (_req: Request, res: Response) => {
        res.status(200).json({ data: "dispense-granted" });
      },
    );

    app.use(errorHandler);
    return app;
  }

  describe("System Role Authorization", () => {
    it("allows ADMIN to access admin endpoints", async () => {
      const app = createAuthApp(adminUser);

      const response = await request(app).get("/admin/dashboard");

      expect(response.status).toBe(200);
      expect(response.body.data).toBe("admin-access-granted");
    });

    it("rejects regular USER from accessing admin endpoints with 403 Forbidden", async () => {
      const app = createAuthApp(regularUser);

      const response = await request(app).get("/admin/dashboard");

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    });

    it("rejects unauthenticated requests with 401 Unauthorized", async () => {
      const app = createAuthApp(null);

      const response = await request(app).get("/admin/dashboard");

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("Station Membership Authorization", () => {
    const stationId = "station-uuid-100";

    it("allows station OWNER to access owner-only station routes", async () => {
      const app = createAuthApp(regularUser);

      const selectSpy = vi.spyOn(db, "select").mockReturnValue({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  stationId,
                  role: "OWNER",
                  status: "ACTIVE",
                },
              ]),
          }),
        }),
      } as any);

      const response = await request(app).get(`/stations/${stationId}/settlements`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBe("owner-settlements-granted");

      selectSpy.mockRestore();
    });

    it("rejects station ATTENDANT from accessing OWNER-only station routes with 403", async () => {
      const app = createAuthApp(regularUser);

      const selectSpy = vi.spyOn(db, "select").mockReturnValue({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  stationId,
                  role: "ATTENDANT",
                  status: "ACTIVE",
                },
              ]),
          }),
        }),
      } as any);

      const response = await request(app).get(`/stations/${stationId}/settlements`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");

      selectSpy.mockRestore();
    });

    it("allows station ATTENDANT to access attendant-permitted routes", async () => {
      const app = createAuthApp(regularUser);

      const selectSpy = vi.spyOn(db, "select").mockReturnValue({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  stationId,
                  role: "ATTENDANT",
                  status: "ACTIVE",
                },
              ]),
          }),
        }),
      } as any);

      const response = await request(app).get(`/stations/${stationId}/fuel-dispense`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBe("dispense-granted");

      selectSpy.mockRestore();
    });

    it("rejects user with NO membership at target station with 403 Forbidden", async () => {
      const app = createAuthApp(regularUser);

      const selectSpy = vi.spyOn(db, "select").mockReturnValue({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]), // No membership found
          }),
        }),
      } as any);

      const response = await request(app).get(`/stations/${stationId}/fuel-dispense`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");

      selectSpy.mockRestore();
    });

    it("rejects user whose station membership is INACTIVE", async () => {
      const app = createAuthApp(regularUser);

      const selectSpy = vi.spyOn(db, "select").mockReturnValue({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]), // status='ACTIVE' filter yields 0 rows
          }),
        }),
      } as any);

      const response = await request(app).get(`/stations/${stationId}/fuel-dispense`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");

      selectSpy.mockRestore();
    });

    it("allows platform ADMIN universal access across all stations", async () => {
      const app = createAuthApp(adminUser);

      // No station membership query needed for ADMIN
      const response = await request(app).get(`/stations/${stationId}/settlements`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBe("owner-settlements-granted");
    });
  });
});

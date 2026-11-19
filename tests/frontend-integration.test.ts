import { beforeEach, describe, expect, it, vi } from "vitest";
import session from "express-session";
import request from "supertest";

import { createApp } from "../src/app.js";
import { authService } from "../src/modules/auth/auth.service.js";
import { walletService } from "../src/modules/wallet/wallet.service.js";
import { fuelPurchasesService } from "../src/modules/fuel-purchases/fuel-purchases.service.js";
import { settlementsService } from "../src/modules/settlements/settlements.service.js";
import { balanceService } from "../src/modules/financial-core/balance.service.js";

describe("Frontend <-> Backend Integration Contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockDriverUser = {
    id: "11111111-1111-4111-8111-111111111111",
    fullName: "أحمد السائق",
    phone: "+249911111111",
    systemRole: "USER" as const,
    status: "ACTIVE" as const,
  };

  const mockAdminUser = {
    id: "99999999-9999-4999-8999-999999999999",
    fullName: "مدير المنصة",
    phone: "+249900000000",
    systemRole: "ADMIN" as const,
    status: "ACTIVE" as const,
  };

  function createTestApp() {
    return createApp({
      databaseReadinessCheck: async () => {},
      sessionStore: new session.MemoryStore(),
    });
  }

  it("Journey A: CSRF token bootstrap, session-based authentication, and current profile", async () => {
    const app = createTestApp();

    // 1. Obtain CSRF token
    const csrfRes = await request(app).get("/api/v1/auth/csrf");
    expect(csrfRes.status).toBe(200);
    const csrfToken = csrfRes.body.data.csrfToken;
    expect(csrfToken).toBeDefined();
    expect(typeof csrfToken).toBe("string");
    const sessionCookie = csrfRes.headers["set-cookie"]?.[0];
    expect(sessionCookie).toBeDefined();

    // 2. Unauthenticated /users/me returns 401
    const unauthMe = await request(app).get("/api/v1/users/me");
    expect(unauthMe.status).toBe(401);
    expect(unauthMe.body.error.code).toBe("UNAUTHORIZED");

    // 3. Login with session cookie and CSRF token
    vi.spyOn(authService, "verifyCredentials").mockResolvedValueOnce(mockDriverUser);

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .set("Cookie", sessionCookie)
      .set("X-CSRF-Token", csrfToken)
      .send({ phone: mockDriverUser.phone, password: "ValidPassword123!" });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.user.id).toBe(mockDriverUser.id);
    expect(loginRes.body.data.user.fullName).toBe(mockDriverUser.fullName);
    expect(loginRes.body.data.csrfToken).toBeDefined();
    expect(loginRes.body.token).toBeUndefined(); // Strictly no JWT

    const authenticatedCookie = loginRes.headers["set-cookie"]?.[0];
    expect(authenticatedCookie).toBeDefined();

    // 4. Authenticated /users/me loads user profile with memberships
    vi.spyOn(authService, "getUserById").mockResolvedValueOnce(mockDriverUser);
    vi.spyOn(authService, "getUserMemberships").mockResolvedValueOnce([]);

    const meRes = await request(app)
      .get("/api/v1/users/me")
      .set("Cookie", authenticatedCookie);

    expect(meRes.status).toBe(200);
    expect(meRes.body.data.id).toBe(mockDriverUser.id);
    expect(meRes.body.data.full_name).toBe(mockDriverUser.fullName);
    expect(meRes.body.data.system_role).toBe("USER");
    expect(Array.isArray(meRes.body.data.station_memberships)).toBe(true);

    // 5. Unsafe mutation without CSRF token is rejected with 403 Forbidden
    vi.spyOn(authService, "getUserById").mockResolvedValueOnce(mockDriverUser);
    const noCsrfRes = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", authenticatedCookie);

    expect(noCsrfRes.status).toBe(403);
    expect(noCsrfRes.body.error.message).toContain("CSRF");

    // 6. Logout with CSRF token destroys session
    vi.spyOn(authService, "getUserById").mockResolvedValueOnce(mockDriverUser);
    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", authenticatedCookie)
      .set("X-CSRF-Token", loginRes.body.data.csrfToken);

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.data.message).toContain("successfully");
  });

  it("Journey B: Driver wallet summary and frontend top-up endpoint mapping", async () => {
    const app = createTestApp();

    const csrfRes = await request(app).get("/api/v1/auth/csrf");
    const sessionCookie = csrfRes.headers["set-cookie"]?.[0];
    const csrfToken = csrfRes.body.data.csrfToken;

    vi.spyOn(authService, "verifyCredentials").mockResolvedValueOnce(mockDriverUser);

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .set("Cookie", sessionCookie)
      .set("X-CSRF-Token", csrfToken)
      .send({ phone: mockDriverUser.phone, password: "ValidPassword123!" });

    const authCookie = loginRes.headers["set-cookie"]?.[0];
    const newCsrf = loginRes.body.data.csrfToken;

    // Check wallet summary returns both camelCase and snake_case properties
    vi.spyOn(authService, "getUserById").mockResolvedValueOnce(mockDriverUser);
    vi.spyOn(balanceService, "getUserWalletSummary").mockResolvedValueOnce({
      userId: mockDriverUser.id,
      availableAccount: {
        accountId: "22222222-2222-4222-8222-222222222222",
        ledgerBalance: "50000.00",
        activeHolds: "0.00",
        spendableBalance: "50000.00",
      },
      stationAllocations: [],
      totalAllocatedBalance: "0.00",
      currency: "SDG",
    });

    const walletRes = await request(app)
      .get("/api/v1/wallet")
      .set("Cookie", authCookie);

    expect(walletRes.status).toBe(200);
    expect(walletRes.body.data.availableBalance).toBe("50000.00");
    expect(walletRes.body.data.available_balance).toBe("50000.00");
    expect(walletRes.body.data.wallet.availableBalance).toBe("50000.00");

    // Check allocations list returns empty array
    vi.spyOn(authService, "getUserById").mockResolvedValueOnce(mockDriverUser);
    vi.spyOn(balanceService, "getUserWalletSummary").mockResolvedValueOnce({
      userId: mockDriverUser.id,
      availableAccount: {
        accountId: "22222222-2222-4222-8222-222222222222",
        ledgerBalance: "50000.00",
        activeHolds: "0.00",
        spendableBalance: "50000.00",
      },
      stationAllocations: [
        {
          stationId: "33333333-3333-4333-8333-333333333333",
          stationName: "محطة النيل",
          accountId: "44444444-4444-4444-8444-444444444444",
          ledgerBalance: "20000.00",
          activeHolds: "0.00",
          availableBalance: "20000.00",
        },
      ],
      totalAllocatedBalance: "20000.00",
      currency: "SDG",
    });

    const allocRes = await request(app)
      .get("/api/v1/allocations")
      .set("Cookie", authCookie);

    expect(allocRes.status).toBe(200);
    expect(Array.isArray(allocRes.body.data)).toBe(true);
    expect(allocRes.body.data[0].station_name).toBe("محطة النيل");
    expect(allocRes.body.data[0].amount).toBe("20000.00");
    expect(allocRes.body.data[0].available_amount).toBe("20000.00");
  });

  it("Journey C: Admin topups review and eligible settlements integration", async () => {
    const app = createTestApp();

    const csrfRes = await request(app).get("/api/v1/auth/csrf");
    const sessionCookie = csrfRes.headers["set-cookie"]?.[0];
    const csrfToken = csrfRes.body.data.csrfToken;

    vi.spyOn(authService, "verifyCredentials").mockResolvedValueOnce(mockAdminUser);

    const loginRes = await request(app)
      .post("/api/v1/auth/login")
      .set("Cookie", sessionCookie)
      .set("X-CSRF-Token", csrfToken)
      .send({ phone: mockAdminUser.phone, password: "AdminPassword123!" });

    const authCookie = loginRes.headers["set-cookie"]?.[0];

    // Admin eligible settlements endpoint
    vi.spyOn(authService, "getUserById").mockResolvedValue(mockAdminUser);
    vi.spyOn(settlementsService, "getEligibleStations").mockResolvedValueOnce([
      {
        station: {
          id: "33333333-3333-4333-8333-333333333333",
          name: "محطة النيل",
          address: "شارع النيل",
          minimumSettlementAmount: "10000.00",
          status: "ACTIVE",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        summary: {
          stationId: "33333333-3333-4333-8333-333333333333",
          accountId: "44444444-4444-4444-8444-444444444444",
          ledgerBalance: "50000.00",
          activeHolds: "0.00",
          availableSettlement: "50000.00",
          minimumSettlementAmount: "10000.00",
          isEligibleForSettlement: true,
        },
      },
    ]);

    const settlementsRes = await request(app)
      .get("/api/v1/admin/settlements/eligible")
      .set("Cookie", authCookie);

    expect(settlementsRes.status).toBe(200);
    expect(Array.isArray(settlementsRes.body.data)).toBe(true);
    expect(settlementsRes.body.data[0].station_name).toBe("محطة النيل");
    expect(settlementsRes.body.data[0].payable_balance).toBe("50000.00");
    expect(settlementsRes.body.data[0].available_amount).toBe("50000.00");
    expect(settlementsRes.body.data[0].minimum_settlement_amount).toBe("10000.00");
  });
});

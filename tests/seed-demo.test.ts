import { describe, expect, it } from "vitest";

import {
  buildPlan,
  calculatePlanBalances,
  demoBankAccounts,
  demoStations,
  demoUsers,
  ids,
  validateSafety,
} from "../src/scripts/seed-demo.js";

describe("Phase 10: Demo Data Seeding", () => {
  const validBaseEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "development",
    DEMO_SEED_ENABLED: "true",
    DEMO_SEED_PASSWORD: "demo-secure-password-1234",
    DEMO_SEED_CONFIRM_DATABASE: "fuel_wallet_dev",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/fuel_wallet_dev",
    ALLOW_REMOTE_DEMO_SEED: "false",
  };

  describe("Safety Requirements & Preflight Validation", () => {
    it("rejects seeding when NODE_ENV=production", async () => {
      await expect(
        validateSafety({ ...validBaseEnv, NODE_ENV: "production" }),
      ).rejects.toThrow(/Production demo seeding is strictly prohibited/);
    });

    it("rejects seeding when NODE_ENV is not exactly development", async () => {
      await expect(
        validateSafety({ ...validBaseEnv, NODE_ENV: "staging" as any }),
      ).rejects.toThrow(/NODE_ENV=development/);
    });

    it("rejects seeding when DEMO_SEED_ENABLED is not true", async () => {
      await expect(
        validateSafety({ ...validBaseEnv, DEMO_SEED_ENABLED: "false" }),
      ).rejects.toThrow(/DEMO_SEED_ENABLED=true/);

      await expect(
        validateSafety({ ...validBaseEnv, DEMO_SEED_ENABLED: undefined }),
      ).rejects.toThrow(/DEMO_SEED_ENABLED=true/);
    });

    it("rejects seeding when DEMO_SEED_PASSWORD is missing or shorter than 12 characters", async () => {
      await expect(
        validateSafety({ ...validBaseEnv, DEMO_SEED_PASSWORD: undefined }),
      ).rejects.toThrow(/DEMO_SEED_PASSWORD/);

      await expect(
        validateSafety({ ...validBaseEnv, DEMO_SEED_PASSWORD: "short-pass" }),
      ).rejects.toThrow(/at least 12 characters/);
    });

    it("rejects seeding when DEMO_SEED_PASSWORD exceeds 72 bytes", async () => {
      const longPassword = "A".repeat(73);
      await expect(
        validateSafety({ ...validBaseEnv, DEMO_SEED_PASSWORD: longPassword }),
      ).rejects.toThrow(/exceeds maximum allowed limit of 72 UTF-8 bytes/);
    });

    it("rejects seeding when DEMO_SEED_CONFIRM_DATABASE is missing or empty", async () => {
      await expect(
        validateSafety({ ...validBaseEnv, DEMO_SEED_CONFIRM_DATABASE: undefined }),
      ).rejects.toThrow(/DEMO_SEED_CONFIRM_DATABASE/);

      await expect(
        validateSafety({ ...validBaseEnv, DEMO_SEED_CONFIRM_DATABASE: "   " }),
      ).rejects.toThrow(/DEMO_SEED_CONFIRM_DATABASE/);
    });

    it("rejects seeding when DATABASE_URL is missing or malformed", async () => {
      await expect(
        validateSafety({ ...validBaseEnv, DATABASE_URL: undefined }),
      ).rejects.toThrow(/DATABASE_URL/);

      await expect(
        validateSafety({ ...validBaseEnv, DATABASE_URL: "invalid-url" }),
      ).rejects.toThrow(/valid DATABASE_URL/);
    });

    it("rejects seeding against a remote database unless ALLOW_REMOTE_DEMO_SEED=true", async () => {
      const remoteEnv = {
        ...validBaseEnv,
        DATABASE_URL: "postgresql://user:pass@ep-cool-db.us-east-2.aws.neon.tech/neondb?sslmode=require",
        DEMO_SEED_CONFIRM_DATABASE: "neondb",
        ALLOW_REMOTE_DEMO_SEED: "false",
      };

      await expect(validateSafety(remoteEnv)).rejects.toThrow(
        /Remote demo seeding requires ALLOW_REMOTE_DEMO_SEED=true/,
      );
    });

    it("permits seeding against a remote database when ALLOW_REMOTE_DEMO_SEED=true", async () => {
      const remoteEnv = {
        ...validBaseEnv,
        DATABASE_URL: "postgresql://user:pass@ep-cool-db.us-east-2.aws.neon.tech/neondb?sslmode=require",
        DEMO_SEED_CONFIRM_DATABASE: "neondb",
        ALLOW_REMOTE_DEMO_SEED: "true",
      };

      const result = await validateSafety(remoteEnv);
      expect(result.isLocal).toBe(false);
      expect(result.confirmedDatabase).toBe("neondb");
    });

    it("passes validation for a local database", async () => {
      const result = await validateSafety(validBaseEnv);
      expect(result.isLocal).toBe(true);
      expect(result.confirmedDatabase).toBe("fuel_wallet_dev");
    });
  });

  describe("Demo Dataset Plan Structure & Constraints", () => {
    const accountIds = {
      ...ids,
      platformCash: ids.platformCash,
    };
    const now = new Date("2026-11-15T08:00:00Z");
    const plan = buildPlan(accountIds, now, "$2b$12$fakeHashForDeterministicTesting");

    it("generates exactly 8 demo users with deterministic IDs and valid roles", () => {
      expect(plan.users).toHaveLength(8);

      const admin = plan.users.find((u) => u.id === ids.admin);
      expect(admin).toBeDefined();
      expect(admin?.systemRole).toBe("ADMIN");
      expect(admin?.phone).toBe("+249900000100");
      expect(admin?.status).toBe("ACTIVE");

      const drivers = plan.users.filter((u) =>
        [ids.driverOne, ids.driverTwo, ids.driverThree].includes(u.id!),
      );
      expect(drivers).toHaveLength(3);
      for (const driver of drivers) {
        expect(driver.systemRole).toBe("USER");
        expect(driver.status).toBe("ACTIVE");
      }
    });

    it("generates exactly 2 demo stations with minimum settlement threshold of 10,000.00", () => {
      expect(plan.stations).toHaveLength(2);
      for (const station of plan.stations) {
        expect(station.status).toBe("ACTIVE");
        expect(station.minimumSettlementAmount).toBe("10000.00");
      }
      expect(plan.stations[0].name).toBe("محطة النيل التجريبية");
      expect(plan.stations[1].name).toBe("محطة أم درمان التجريبية");
    });

    it("creates exactly 4 station memberships without global admin privileges", () => {
      expect(plan.memberships).toHaveLength(4);

      const nileOwner = plan.memberships.find(
        (m) => m.stationId === ids.stationNile && m.userId === ids.ownerNile,
      );
      expect(nileOwner?.role).toBe("OWNER");

      const nileAttendant = plan.memberships.find(
        (m) => m.stationId === ids.stationNile && m.userId === ids.attendantNile,
      );
      expect(nileAttendant?.role).toBe("ATTENDANT");

      const omdurmanOwner = plan.memberships.find(
        (m) => m.stationId === ids.stationOmdurman && m.userId === ids.ownerOmdurman,
      );
      expect(omdurmanOwner?.role).toBe("OWNER");

      const omdurmanAttendant = plan.memberships.find(
        (m) => m.stationId === ids.stationOmdurman && m.userId === ids.attendantOmdurman,
      );
      expect(omdurmanAttendant?.role).toBe("ATTENDANT");
    });

    it("creates synthetic bank accounts under DEMO BANK with valid identifiers", () => {
      expect(plan.bankAccounts).toHaveLength(5);
      for (const account of plan.bankAccounts) {
        expect(account.bankName).toBe("DEMO BANK");
        expect(account.accountNumber).toMatch(/^DEMO-(USER|STATION)-\d+$/);
        expect(account.isActive).toBe(true);
        expect(account.isPrimary).toBe(true);
      }
    });

    it("creates fuel prices adhering to price-period constraints", () => {
      expect(plan.prices).toHaveLength(4);
      for (const price of plan.prices) {
        expect(price.validUntil).toBeNull();
        expect(Number(price.pricePerLiter)).toBeGreaterThan(0);
      }

      const nilePetrol = plan.prices.find(
        (p) => p.stationId === ids.stationNile && p.fuelType === "PETROL",
      );
      expect(nilePetrol?.pricePerLiter).toBe("5000.00");

      const nileDiesel = plan.prices.find(
        (p) => p.stationId === ids.stationNile && p.fuelType === "DIESEL",
      );
      expect(nileDiesel?.pricePerLiter).toBe("4700.00");

      const omdurmanPetrol = plan.prices.find(
        (p) => p.stationId === ids.stationOmdurman && p.fuelType === "PETROL",
      );
      expect(omdurmanPetrol?.pricePerLiter).toBe("5100.00");

      const omdurmanDiesel = plan.prices.find(
        (p) => p.stationId === ids.stationOmdurman && p.fuelType === "DIESEL",
      );
      expect(omdurmanDiesel?.pricePerLiter).toBe("4800.00");
    });

    it("creates 10 financial accounts with proper invariants", () => {
      expect(plan.accounts).toHaveLength(10);
      const cash = plan.accounts.find((a) => a.accountType === "PLATFORM_CASH");
      expect(cash?.userId).toBeNull();
      expect(cash?.stationId).toBeNull();

      const payables = plan.accounts.filter((a) => a.accountType === "STATION_PAYABLE");
      expect(payables).toHaveLength(2);
      for (const p of payables) {
        expect(p.userId).toBeNull();
        expect(p.stationId).toBeDefined();
      }
    });

    it("creates 15 transactions with all references prefixed by DEMO-", () => {
      expect(plan.transactions).toHaveLength(15);
      for (const t of plan.transactions) {
        expect(t.idempotencyKey).toMatch(/^DEMO-/);
        if (t.submittedBankReference) {
          expect(t.submittedBankReference).toMatch(/^DEMO-/);
        }
        if (t.outgoingBankReference) {
          expect(t.outgoingBankReference).toMatch(/^DEMO-/);
        }
      }

      const completed = plan.transactions.filter((t) => t.status === "COMPLETED");
      const pending = plan.transactions.filter((t) => t.status === "PENDING");
      expect(completed).toHaveLength(13);
      expect(pending).toHaveLength(2);
    });

    it("creates 26 financial entries strictly paired as DEBIT and CREDIT", () => {
      expect(plan.entries).toHaveLength(26);

      const byTx = new Map<string, typeof plan.entries>();
      for (const entry of plan.entries) {
        const list = byTx.get(entry.transactionId!) ?? [];
        list.push(entry);
        byTx.set(entry.transactionId!, list);
      }

      expect(byTx.size).toBe(13); // exactly 13 completed transactions
      for (const [txId, entries] of byTx.entries()) {
        expect(entries).toHaveLength(2);
        const debit = entries.find((e) => e.entryType === "DEBIT");
        const credit = entries.find((e) => e.entryType === "CREDIT");
        expect(debit).toBeDefined();
        expect(credit).toBeDefined();
        expect(debit?.amount).toBe(credit?.amount);
      }
    });

    it("creates exactly 3 fuel purchase records with holds settled", () => {
      expect(plan.fuelPurchases).toHaveLength(3);

      const p1 = plan.transactions.find((t) => t.id === ids.fuelOne);
      expect(p1?.holdAmount).toBe("22000.00");
      expect(p1?.capturedAmount).toBe("20000.00");
      expect(p1?.releasedAmount).toBe("2000.00");

      const p2 = plan.transactions.find((t) => t.id === ids.fuelTwo);
      expect(p2?.holdAmount).toBe("10000.00");
      expect(p2?.capturedAmount).toBe("9400.00");
      expect(p2?.releasedAmount).toBe("600.00");

      const p3 = plan.transactions.find((t) => t.id === ids.fuelThree);
      expect(p3?.holdAmount).toBe("5500.00");
      expect(p3?.capturedAmount).toBe("5100.00");
      expect(p3?.releasedAmount).toBe("400.00");
    });

    it("creates audit events with metadata demoSeed: true", () => {
      expect(plan.events.length).toBeGreaterThanOrEqual(40);
      for (const event of plan.events) {
        expect(event.metadata).toHaveProperty("demoSeed", true);
        expect(event.metadata).toHaveProperty("scenario");
      }
    });
  });

  describe("In-Memory Ledger Balances & Accounting Equality", () => {
    const accountIds = {
      ...ids,
      platformCash: ids.platformCash,
    };
    const now = new Date("2026-11-15T08:00:00Z");
    const plan = buildPlan(accountIds, now);

    it("computes exact expected balances and satisfies the accounting equality equation", () => {
      const analysis = calculatePlanBalances(plan, accountIds);

      // Platform Cash
      expect(analysis.balances[accountIds.platformCash]).toBe("215000.00");

      // Driver One
      expect(analysis.balances[accountIds.availableOne]).toBe("40000.00");
      expect(analysis.balances[accountIds.allocatedOneNile]).toBe("25000.00");
      expect(analysis.balances[accountIds.allocatedOneOmdurman]).toBe("15000.00");

      // Driver Two
      expect(analysis.balances[accountIds.availableTwo]).toBe("45000.00");
      expect(analysis.balances[accountIds.allocatedTwoNile]).toBe("20600.00");
      expect(analysis.activeHolds[accountIds.availableTwo]).toBe("5000.00"); // 5,000.00 pending withdrawal hold

      // Driver Three
      expect(analysis.balances[accountIds.availableThree]).toBe("30000.00");
      expect(analysis.balances[accountIds.allocatedThreeOmdurman]).toBe("14900.00");

      // Stations
      expect(analysis.balances[accountIds.payableNile]).toBe("19400.00");
      expect(analysis.balances[accountIds.payableOmdurman]).toBe("5100.00");

      // Accounting equality: Platform Cash (215,000.00) = Total Liabilities (190,500.00) + Total Payables (24,500.00)
      expect(analysis.accountingEqualityVerified).toBe(true);
    });
  });
});

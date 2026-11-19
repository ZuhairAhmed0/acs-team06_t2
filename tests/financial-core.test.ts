import { describe, expect, it, vi } from "vitest";

import { balanceService } from "../src/modules/financial-core/balance.service.js";
import { financialAccountService } from "../src/modules/financial-core/financial-account.service.js";
import { financialEventsService } from "../src/modules/financial-core/financial-events.service.js";
import { holdService } from "../src/modules/financial-core/hold.service.js";
import { idempotencyService } from "../src/modules/financial-core/idempotency.service.js";
import { ledgerService } from "../src/modules/financial-core/ledger.service.js";
import type { LedgerEntryInput } from "../src/modules/financial-core/financial.types.js";
import {
  BadRequestError,
  ConflictError,
  UnprocessableContentError,
} from "../src/shared/errors/app-error.js";
import {
  addMonetary,
  compareMonetary,
  multiplyFuelPrice,
  subtractMonetary,
} from "../src/shared/precision/money.js";

describe("Phase 5: Financial Core", () => {
  describe("Exact Decimal & Fuel Arithmetic", () => {
    it("multiplies fuel quantity and unit price with HALF_UP rounding to 2 decimals", () => {
      // 5.000 * 1000.00 = 5000.00
      expect(multiplyFuelPrice("5.000", "1000.00")).toBe("5000.00");

      // 4.889 * 1200.50 = 5869.2445 -> 5869.24
      expect(multiplyFuelPrice("4.889", "1200.50")).toBe("5869.24");

      // 4.889 * 1200.55 = 5869.48895 -> 5869.49 (rounds up at 895 >= 500)
      expect(multiplyFuelPrice("4.889", "1200.55")).toBe("5869.49");

      // 10.000 * 550.25 = 5502.50
      expect(multiplyFuelPrice("10.000", "550.25")).toBe("5502.50");
    });

    it("handles zero loss on exact monetary additions and subtractions", () => {
      const sum = addMonetary("0.10", "0.20");
      expect(sum).toBe("0.30");

      const diff = subtractMonetary("100.00", "33.33");
      expect(diff).toBe("66.67");
    });
  });

  describe("Idempotency Service", () => {
    it("produces deterministic hash regardless of object key order", () => {
      const obj1 = { stationId: "station-1", amount: "5000.00", fuelType: "PETROL" };
      const obj2 = { fuelType: "PETROL", amount: "5000.00", stationId: "station-1" };

      const hash1 = idempotencyService.hashPayload(obj1);
      const hash2 = idempotencyService.hashPayload(obj2);

      expect(hash1).toBe(hash2);
    });

    it("throws ConflictError if same idempotency key is checked with different payload", async () => {
      const mockTx = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [
                {
                  id: "existing-tx-id",
                  createdByUserId: "user-1",
                  idempotencyKey: "key-123",
                  requestHash: "original-hash-value-aabbcc",
                },
              ],
            }),
          }),
        }),
      } as any;

      await expect(
        idempotencyService.checkIdempotency("user-1", "key-123", "different-hash-value", mockTx),
      ).rejects.toThrow(ConflictError);
    });

    it("returns existing transaction if idempotency key and hash match", async () => {
      const existingRecord = {
        id: "existing-tx-id",
        createdByUserId: "user-1",
        idempotencyKey: "key-123",
        requestHash: "matching-hash-value",
      };

      const mockTx = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [existingRecord],
            }),
          }),
        }),
      } as any;

      const result = await idempotencyService.checkIdempotency(
        "user-1",
        "key-123",
        "matching-hash-value",
        mockTx,
      );

      expect(result).toEqual(existingRecord);
    });
  });

  describe("Hold Service Logic", () => {
    it("correctly calculates outstanding hold", () => {
      const txData = {
        holdAmount: "25000.00",
        capturedAmount: "20000.00",
        releasedAmount: "0.00",
      };

      expect(holdService.getOutstandingHold(txData)).toBe("5000.00");
    });

    it("rejects non-positive hold creation amounts", async () => {
      const mockTx = {} as any;
      await expect(
        holdService.createHold(mockTx, {
          transactionId: "tx-1",
          holdAccountId: "acc-1",
          holdAmount: "0.00",
        }),
      ).rejects.toThrow(BadRequestError);
    });

    it("rejects capture exceeding outstanding hold", async () => {
      const mockTx = {
        select: () => ({
          from: () => ({
            where: () => ({
              for: async () => [
                {
                  id: "tx-1",
                  holdAccountId: "acc-1",
                  holdAmount: "10000.00",
                  capturedAmount: "8000.00",
                  releasedAmount: "0.00",
                },
              ],
            }),
          }),
        }),
      } as any;

      // Remaining is 2000.00; attempting to capture 3000.00 must throw ConflictError
      await expect(
        holdService.captureHold(mockTx, {
          transactionId: "tx-1",
          captureAmount: "3000.00",
        }),
      ).rejects.toThrow(ConflictError);
    });

    it("rejects release exceeding outstanding hold", async () => {
      const mockTx = {
        select: () => ({
          from: () => ({
            where: () => ({
              for: async () => [
                {
                  id: "tx-1",
                  holdAccountId: "acc-1",
                  holdAmount: "10000.00",
                  capturedAmount: "5000.00",
                  releasedAmount: "4000.00",
                },
              ],
            }),
          }),
        }),
      } as any;

      // Remaining is 1000.00; attempting to release 1500.00 must throw ConflictError
      await expect(
        holdService.releaseHold(mockTx, {
          transactionId: "tx-1",
          releaseAmount: "1500.00",
        }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("Ledger Service Movement Balancing", () => {
    it("rejects movements with fewer than 2 entries", async () => {
      const mockTx = {} as any;
      await expect(
        ledgerService.postBalancedMovement(mockTx, {
          transactionId: "tx-1",
          entries: [{ financialAccountId: "acc-1", entryType: "DEBIT", amount: "100.00" }],
        }),
      ).rejects.toThrow(UnprocessableContentError);
    });

    it("rejects unbalanced movements where Total Debit != Total Credit", async () => {
      const mockTx = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                for: async () => [{ id: "acc-1" }, { id: "acc-2" }],
              }),
            }),
          }),
        }),
      } as any;

      await expect(
        ledgerService.postBalancedMovement(mockTx, {
          transactionId: "tx-1",
          entries: [
            { financialAccountId: "acc-1", entryType: "DEBIT", amount: "100.00" },
            { financialAccountId: "acc-2", entryType: "CREDIT", amount: "99.00" },
          ],
        }),
      ).rejects.toThrow(UnprocessableContentError);
    });

    it("successfully posts balanced movements and locks accounts deterministically", async () => {
      const lockSpy = vi.spyOn(financialAccountService, "lockAccounts").mockResolvedValue([
        { id: "acc-1" } as any,
        { id: "acc-2" } as any,
      ]);

      const mockTx = {
        insert: () => ({
          values: () => ({
            returning: async () => [
              { id: "e-1", amount: "50000.00", entryType: "DEBIT" },
              { id: "e-2", amount: "50000.00", entryType: "CREDIT" },
            ],
          }),
        }),
      } as any;

      const entries: LedgerEntryInput[] = [
        { financialAccountId: "acc-2", entryType: "CREDIT", amount: "50000.00" },
        { financialAccountId: "acc-1", entryType: "DEBIT", amount: "50000.00" },
      ];

      const result = await ledgerService.postBalancedMovement(mockTx, {
        transactionId: "tx-1",
        entries,
        actorUserId: "admin-1",
      });

      expect(lockSpy).toHaveBeenCalledWith(["acc-2", "acc-1"], mockTx);
      expect(result).toHaveLength(2);
    });
  });

  describe("Sensitive Metadata Redaction in Financial Events", () => {
    it("redacts sensitive fields like passwords, tokens, and pins from audit metadata", async () => {
      let insertedPayload: any = null;

      const mockTx = {
        insert: () => ({
          values: (payload: any) => {
            insertedPayload = payload;
            return {
              returning: async () => [payload],
            };
          },
        }),
      } as any;

      await financialEventsService.recordEvent(
        {
          transactionId: "tx-audit-1",
          eventType: "TEST_AUDIT",
          metadata: {
            safeAmount: "1000.00",
            secretToken: "super-secret-value",
            bankDetails: {
              accountHolder: "Ahmed",
              userPin: "1234",
            },
          },
        },
        mockTx,
      );

      expect(insertedPayload.metadata.safeAmount).toBe("1000.00");
      expect(insertedPayload.metadata.secretToken).toBe("[REDACTED]");
      expect(insertedPayload.metadata.bankDetails.accountHolder).toBe("Ahmed");
      expect(insertedPayload.metadata.bankDetails.userPin).toBe("[REDACTED]");
    });
  });
});

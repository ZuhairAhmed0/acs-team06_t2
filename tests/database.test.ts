import pg from "pg";
import { describe, expect, it, vi } from "vitest";

import { db } from "../src/db/client.js";
import {
  withTransaction,
  type DatabaseTransaction,
} from "../src/db/transaction.js";
import { ConflictError } from "../src/shared/errors/app-error.js";

describe("Database Infrastructure & Transaction Utility", () => {
  it("enforces that pg NUMERIC (OID 1700) is parsed as string and never converted to Number", () => {
    const numericParser = pg.types.getTypeParser(1700);

    const testValue = "123456789.99";
    const parsed = numericParser(testValue);

    expect(typeof parsed).toBe("string");
    expect(parsed).toBe("123456789.99");
    // Ensure it was NOT converted to a JavaScript float
    expect(typeof parsed).not.toBe("number");
  });

  describe("withTransaction", () => {
    it("executes the callback within a transaction and returns its result", async () => {
      const mockTx = { isMockTransaction: true } as unknown as DatabaseTransaction;

      const transactionSpy = vi
        .spyOn(db, "transaction")
        .mockImplementation(async (callback: any) => {
          return callback(mockTx);
        });

      const result = await withTransaction(async (tx) => {
        expect(tx).toBe(mockTx);
        return { success: true, count: 42 };
      });

      expect(result).toEqual({ success: true, count: 42 });
      expect(transactionSpy).toHaveBeenCalledOnce();

      transactionSpy.mockRestore();
    });

    it("propagates the exact original application error and triggers rollback when callback throws", async () => {
      const customAppError = new ConflictError("Concurrent wallet hold detected.");

      const transactionSpy = vi
        .spyOn(db, "transaction")
        .mockImplementation(async (callback: any) => {
          // Drizzle transaction wrapper catches the error, rolls back, and rethrows
          try {
            return await callback({} as DatabaseTransaction);
          } catch (err) {
            // Emulate rollback
            throw err;
          }
        });

      await expect(
        withTransaction(async () => {
          throw customAppError;
        }),
      ).rejects.toThrow(customAppError);

      transactionSpy.mockRestore();
    });

    it("participates in an existing transaction if one is provided without nesting", async () => {
      const existingTx = { existing: true } as unknown as DatabaseTransaction;
      const transactionSpy = vi.spyOn(db, "transaction");

      const result = await withTransaction(async (tx) => {
        expect(tx).toBe(existingTx);
        return "reused";
      }, existingTx);

      expect(result).toBe("reused");
      // db.transaction should NOT be called when participating in existingTx
      expect(transactionSpy).not.toHaveBeenCalled();

      transactionSpy.mockRestore();
    });
  });
});

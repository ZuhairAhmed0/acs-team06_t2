import { describe, expect, it } from "vitest";

import {
  addMonetary,
  compareMonetary,
  formatCentsToMonetary,
  isFuelQuantityString,
  isMonetaryString,
  isPositiveMonetary,
  isZeroMonetary,
  parseMonetaryToCents,
  subtractMonetary,
} from "../src/shared/precision/money.js";

describe("Financial Precision & Decimal Arithmetic", () => {
  describe("Format Validators", () => {
    it("validates NUMERIC(18,2) monetary strings correctly", () => {
      expect(isMonetaryString("100.50")).toBe(true);
      expect(isMonetaryString("0.05")).toBe(true);
      expect(isMonetaryString("1000")).toBe(true);
      expect(isMonetaryString("-25.75")).toBe(true);

      expect(isMonetaryString("100.555")).toBe(false); // more than 2 decimal places
      expect(isMonetaryString("abc")).toBe(false);
      expect(isMonetaryString("")).toBe(false);
      expect(isMonetaryString(123)).toBe(false);
      expect(isMonetaryString(null)).toBe(false);
    });

    it("validates NUMERIC(12,3) fuel quantity strings correctly", () => {
      expect(isFuelQuantityString("25.125")).toBe(true);
      expect(isFuelQuantityString("0.500")).toBe(true);
      expect(isFuelQuantityString("10")).toBe(true);
      expect(isFuelQuantityString("999999999.999")).toBe(true);

      expect(isFuelQuantityString("25.1234")).toBe(false); // more than 3 decimal places
      expect(isFuelQuantityString("xyz")).toBe(false);
      expect(isFuelQuantityString("")).toBe(false);
    });
  });

  describe("Lossless Decimal Addition and Subtraction", () => {
    it("demonstrates exact decimal addition avoiding classic IEEE 754 floating-point error", () => {
      // In JavaScript floating-point: 0.1 + 0.2 === 0.30000000000000004
      expect(0.1 + 0.2).not.toBe(0.3);

      // Using addMonetary: exact "0.30"
      const result = addMonetary("0.10", "0.20");
      expect(result).toBe("0.30");
    });

    it("demonstrates exact decimal subtraction", () => {
      expect(subtractMonetary("100.00", "0.01")).toBe("99.99");
      expect(subtractMonetary("50.25", "50.25")).toBe("0.00");
      expect(subtractMonetary("10.00", "15.50")).toBe("-5.50");
    });

    it("handles large financial values up to 18 digits with exact precision", () => {
      const largeA = "9999999999999999.99";
      const smallB = "0.01";

      const sum = addMonetary(largeA, smallB);
      expect(sum).toBe("10000000000000000.00");

      const diff = subtractMonetary("10000000000000000.00", "0.01");
      expect(diff).toBe(largeA);
    });

    it("parses and formats cents without loss", () => {
      expect(parseMonetaryToCents("150.75")).toBe(15075n);
      expect(parseMonetaryToCents("50")).toBe(5000n);
      expect(parseMonetaryToCents("0.05")).toBe(5n);
      expect(parseMonetaryToCents("-12.50")).toBe(-1250n);

      expect(formatCentsToMonetary(15075n)).toBe("150.75");
      expect(formatCentsToMonetary(5000n)).toBe("50.00");
      expect(formatCentsToMonetary(5n)).toBe("0.05");
      expect(formatCentsToMonetary(-1250n)).toBe("-12.50");
    });

    it("compares monetary amounts correctly", () => {
      expect(compareMonetary("100.00", "50.00")).toBe(1);
      expect(compareMonetary("50.00", "100.00")).toBe(-1);
      expect(compareMonetary("75.50", "75.50")).toBe(0);

      expect(isZeroMonetary("0.00")).toBe(true);
      expect(isZeroMonetary("0")).toBe(true);
      expect(isZeroMonetary("0.01")).toBe(false);

      expect(isPositiveMonetary("0.01")).toBe(true);
      expect(isPositiveMonetary("0.00")).toBe(false);
      expect(isPositiveMonetary("-1.00")).toBe(false);
    });
  });
});

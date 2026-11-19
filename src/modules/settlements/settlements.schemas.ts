import { z } from "zod";

import { MONETARY_REGEX } from "../../shared/precision/money.js";

export const createSettlementSchema = z.object({
  stationId: z.string().uuid("Invalid station ID"),
  bankAccountId: z.string().uuid("Invalid bank account ID"),
  requestedAmount: z
    .string()
    .regex(MONETARY_REGEX, "Amount must be a valid 2-decimal monetary string")
    .refine((val) => Number(val) > 0, "Requested amount must be greater than zero"),
});

export const confirmSettlementSuccessSchema = z.object({
  actualAmount: z
    .string()
    .regex(MONETARY_REGEX, "Amount must be a valid 2-decimal monetary string"),
  outgoingBankReference: z
    .string()
    .min(3, "Reference must be at least 3 characters")
    .max(150, "Reference cannot exceed 150 characters"),
});

export const confirmSettlementFailureSchema = z.object({
  reason: z.string().min(3).max(500),
});

export const markSettlementUnknownSchema = z.object({
  reason: z.string().min(3).max(500),
});

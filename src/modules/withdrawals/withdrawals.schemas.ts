import { z } from "zod";

import { MONETARY_REGEX } from "../../shared/precision/money.js";

export const createWithdrawalSchema = z.object({
  bankAccountId: z.string().uuid("Invalid bank account ID"),
  requestedAmount: z
    .string()
    .regex(MONETARY_REGEX, "Amount must be a valid 2-decimal monetary string")
    .refine((val) => Number(val) > 0, "Amount must be greater than zero"),
});

export const confirmOutgoingSuccessSchema = z.object({
  actualAmount: z
    .string()
    .regex(MONETARY_REGEX, "Amount must be a valid 2-decimal monetary string"),
  outgoingBankReference: z
    .string()
    .min(3, "Reference must be at least 3 characters")
    .max(150, "Reference cannot exceed 150 characters"),
});

export const confirmOutgoingFailureSchema = z.object({
  reason: z.string().min(3).max(500),
});

export const markOutgoingUnknownSchema = z.object({
  reason: z.string().min(3).max(500),
});

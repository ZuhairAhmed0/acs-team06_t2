import { z } from "zod";

export const createReversalSchema = z.object({
  reason: z.string().min(5, "Reason is required and must be at least 5 characters").max(500),
  notes: z.string().max(1000).optional(),
  outgoingBankReference: z
    .string()
    .min(3)
    .max(150)
    .optional(),
  incomingBankReference: z
    .string()
    .min(3)
    .max(150)
    .optional(),
});

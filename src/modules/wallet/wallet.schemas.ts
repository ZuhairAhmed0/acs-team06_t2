import { z } from "zod";

import { MONETARY_REGEX } from "../../shared/precision/money.js";

export const topUpRequestSchema = z
  .object({
    requestedAmount: z
      .string()
      .regex(MONETARY_REGEX, "Amount must be a valid 2-decimal monetary string")
      .refine((val) => Number(val) > 0, "Amount must be greater than zero")
      .optional(),
    amount: z
      .union([z.string(), z.number()])
      .optional(),
    bankAccountId: z.string().uuid("Invalid bank account ID").optional(),
    bank_account_id: z.string().uuid("Invalid bank account ID").optional(),
    sender_bank_name: z.string().optional(),
    sender_account_number: z.string().optional(),
    submittedBankReference: z
      .string()
      .min(3, "Bank reference must be at least 3 characters")
      .max(150, "Bank reference cannot exceed 150 characters")
      .optional(),
    bank_reference: z
      .string()
      .min(3, "Bank reference must be at least 3 characters")
      .max(150, "Bank reference cannot exceed 150 characters")
      .optional(),
  })
  .refine(
    (data) => Boolean(data.requestedAmount || data.amount != null),
    { message: "Amount is required", path: ["requestedAmount"] },
  )
  .refine(
    (data) => Boolean(data.submittedBankReference || data.bank_reference),
    { message: "Bank reference is required", path: ["submittedBankReference"] },
  )
  .transform((data) => {
    let reqAmt = data.requestedAmount;
    if (!reqAmt && data.amount != null) {
      reqAmt = typeof data.amount === "number" ? data.amount.toFixed(2) : String(data.amount);
      if (!reqAmt.includes(".")) reqAmt += ".00";
    }
    return {
      requestedAmount: reqAmt as string,
      bankAccountId: (data.bankAccountId ?? data.bank_account_id) as string | undefined,
      senderBankName: data.sender_bank_name,
      senderAccountNumber: data.sender_account_number,
      submittedBankReference: (data.submittedBankReference ?? data.bank_reference) as string,
    };
  });

export const approveTopUpSchema = z.object({
  actualReceivedAmount: z
    .string()
    .regex(MONETARY_REGEX, "Amount must be a valid 2-decimal monetary string")
    .refine((val) => Number(val) > 0, "Amount must be greater than zero")
    .optional(),
  resolutionNote: z.string().max(500).optional(),
  verified_bank_reference: z.string().max(150).optional(),
});

export const rejectTopUpSchema = z.object({
  reason: z.string().min(3).max(500),
});

export const allocationSchema = z
  .object({
    stationId: z.string().uuid("Invalid station ID").optional(),
    station_id: z.string().uuid("Invalid station ID").optional(),
    amount: z.union([z.string(), z.number()]),
  })
  .refine((data) => Boolean(data.stationId || data.station_id), {
    message: "Invalid station ID",
    path: ["stationId"],
  })
  .transform((data) => {
    let amt = typeof data.amount === "number" ? data.amount.toFixed(2) : String(data.amount);
    if (!amt.includes(".")) amt += ".00";
    return {
      stationId: (data.stationId ?? data.station_id) as string,
      amount: amt,
    };
  });

export const deallocationSchema = z
  .object({
    stationId: z.string().uuid("Invalid station ID").optional(),
    station_id: z.string().uuid("Invalid station ID").optional(),
    amount: z.union([z.string(), z.number()]),
  })
  .refine((data) => Boolean(data.stationId || data.station_id), {
    message: "Invalid station ID",
    path: ["stationId"],
  })
  .transform((data) => {
    let amt = typeof data.amount === "number" ? data.amount.toFixed(2) : String(data.amount);
    if (!amt.includes(".")) amt += ".00";
    return {
      stationId: (data.stationId ?? data.station_id) as string,
      amount: amt,
    };
  });

export const transferAllocationSchema = z
  .object({
    sourceStationId: z.string().uuid("Invalid source station ID").optional(),
    source_station_id: z.string().uuid("Invalid source station ID").optional(),
    destinationStationId: z.string().uuid("Invalid destination station ID").optional(),
    destination_station_id: z.string().uuid("Invalid destination station ID").optional(),
    amount: z.union([z.string(), z.number()]),
  })
  .refine((data) => Boolean(data.sourceStationId || data.source_station_id), {
    message: "Invalid source station ID",
    path: ["sourceStationId"],
  })
  .refine((data) => Boolean(data.destinationStationId || data.destination_station_id), {
    message: "Invalid destination station ID",
    path: ["destinationStationId"],
  })
  .transform((data) => {
    let amt = typeof data.amount === "number" ? data.amount.toFixed(2) : String(data.amount);
    if (!amt.includes(".")) amt += ".00";
    return {
      sourceStationId: (data.sourceStationId ?? data.source_station_id) as string,
      destinationStationId: (data.destinationStationId ?? data.destination_station_id) as string,
      amount: amt,
    };
  })
  .refine(
    (data) => data.sourceStationId !== data.destinationStationId,
    {
      message: "Source and destination stations must be different",
      path: ["destinationStationId"],
    },
  );

export const transactionHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum([
    "TOP_UP",
    "WITHDRAWAL",
    "ALLOCATION",
    "DEALLOCATION",
    "TRANSFER",
    "FUEL_PURCHASE",
    "SETTLEMENT",
    "REVERSAL",
  ]).optional(),
  status: z.enum(["PENDING", "PROCESSING", "COMPLETED", "REJECTED", "FAILED", "CANCELLED"]).optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

import { z } from "zod";

import { FUEL_QUANTITY_REGEX, MONETARY_REGEX } from "../../shared/precision/money.js";

export const createFuelPurchaseSchema = z
  .object({
    stationId: z.string().uuid("Invalid station ID").optional(),
    station_id: z.string().uuid("Invalid station ID").optional(),
    requestedAmount: z
      .string()
      .regex(MONETARY_REGEX, "Amount must be a valid 2-decimal monetary string")
      .refine((val) => Number(val) > 0, "Requested amount must be greater than zero")
      .optional(),
    maximum_amount: z.union([z.string(), z.number()]).optional(),
    amount: z.union([z.string(), z.number()]).optional(),
    fuel_type: z.string().optional(),
    fuelType: z.string().optional(),
  })
  .refine((data) => Boolean(data.stationId || data.station_id), {
    message: "Station ID is required",
    path: ["stationId"],
  })
  .refine(
    (data) => Boolean(data.requestedAmount || data.maximum_amount != null || data.amount != null),
    {
      message: "Amount is required",
      path: ["requestedAmount"],
    },
  )
  .transform((data) => {
    let amt = data.requestedAmount;
    const rawAmt = data.maximum_amount ?? data.amount;
    if (!amt && rawAmt != null) {
      amt = typeof rawAmt === "number" ? rawAmt.toFixed(2) : String(rawAmt);
      if (!amt.includes(".")) amt += ".00";
    }
    return {
      stationId: (data.stationId ?? data.station_id) as string,
      requestedAmount: amt as string,
      fuelType: data.fuelType ?? data.fuel_type,
    };
  });

export const startDispensingSchema = z.object({
  fuelType: z.string().min(2).max(30),
  plannedQuantity: z
    .string()
    .regex(FUEL_QUANTITY_REGEX, "Quantity must be a valid 3-decimal fuel quantity string")
    .refine((val) => Number(val) > 0, "Planned quantity must be greater than zero"),
});

export const completeDispensingSchema = z.object({
  actualQuantity: z
    .string()
    .regex(FUEL_QUANTITY_REGEX, "Quantity must be a valid 3-decimal fuel quantity string")
    .refine((val) => Number(val) > 0, "Actual quantity must be greater than zero"),
});

export const markUnknownSchema = z.object({
  reason: z.string().min(3).max(500),
});

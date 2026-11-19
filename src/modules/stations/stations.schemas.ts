import { z } from "zod";

import { MONETARY_REGEX } from "../../shared/precision/money.js";

export const createStationSchema = z.object({
  name: z.string().min(2).max(150),
  address: z.string().min(3),
  minimumSettlementAmount: z
    .string()
    .regex(MONETARY_REGEX, "Amount must be a valid 2-decimal monetary string")
    .refine((val) => Number(val) > 0, "Minimum settlement amount must be positive"),
});

export const addStationMemberSchema = z.object({
  userId: z.string().uuid("Invalid user ID"),
  role: z.enum(["OWNER", "ATTENDANT"]),
});

export const setFuelPriceSchema = z
  .object({
    fuelType: z.string().min(2).max(30).optional(),
    fuel_type: z.string().min(2).max(30).optional(),
    pricePerLiter: z
      .string()
      .regex(MONETARY_REGEX, "Price must be a valid 2-decimal monetary string")
      .refine((val) => Number(val) > 0, "Price per liter must be positive")
      .optional(),
    price: z.union([z.string(), z.number()]).optional(),
    validFrom: z.string().optional(),
    valid_from: z.string().optional(),
    validUntil: z.string().optional(),
    valid_until: z.string().optional(),
  })
  .refine((data) => Boolean(data.fuelType || data.fuel_type), {
    message: "Fuel type is required",
    path: ["fuelType"],
  })
  .refine((data) => Boolean(data.pricePerLiter || data.price != null), {
    message: "Price is required",
    path: ["pricePerLiter"],
  })
  .transform((data) => {
    let p = data.pricePerLiter;
    if (!p && data.price != null) {
      p = typeof data.price === "number" ? data.price.toFixed(2) : String(data.price);
      if (!p.includes(".")) p += ".00";
    }
    return {
      fuelType: ((data.fuelType ?? data.fuel_type) as string).toUpperCase(),
      pricePerLiter: p as string,
      validFrom: data.validFrom ?? data.valid_from,
      validUntil: data.validUntil ?? data.valid_until,
    };
  });

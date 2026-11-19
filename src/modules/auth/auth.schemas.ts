import { z } from "zod";

import {
  MAX_PASSWORD_BYTE_LENGTH,
  MIN_PASSWORD_CHARS,
} from "./password.js";
import { isValidPhoneNumber, normalizePhoneNumber } from "./phone.js";

export const registerSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Full name must be at least 2 characters.")
      .max(150, "Full name cannot exceed 150 characters.")
      .optional(),
    full_name: z
      .string()
      .trim()
      .min(2, "Full name must be at least 2 characters.")
      .max(150, "Full name cannot exceed 150 characters.")
      .optional(),
    phone: z
      .string()
      .trim()
      .refine(isValidPhoneNumber, {
        message: "Invalid phone number format. Must contain 7 to 15 digits.",
      })
      .transform((val) => normalizePhoneNumber(val)),
    password: z
      .string()
      .min(
        MIN_PASSWORD_CHARS,
        `Password must be at least ${MIN_PASSWORD_CHARS} characters long.`,
      )
      .refine(
        (val) => Buffer.byteLength(val, "utf8") <= MAX_PASSWORD_BYTE_LENGTH,
        {
          message: `Password cannot exceed ${MAX_PASSWORD_BYTE_LENGTH} UTF-8 bytes.`,
        },
      ),
  })
  .strict()
  .refine((data) => Boolean(data.fullName || data.full_name), {
    message: "Full name must be at least 2 characters.",
    path: ["fullName"],
  })
  .transform((data) => ({
    fullName: (data.fullName ?? data.full_name) as string,
    phone: data.phone,
    password: data.password,
  }));

export const loginSchema = z
  .object({
    phone: z
      .string()
      .trim()
      .refine(isValidPhoneNumber, {
        message: "Invalid phone number format.",
      })
      .transform((val) => normalizePhoneNumber(val)),
    password: z
      .string()
      .min(1, "Password is required.")
      .refine(
        (val) => Buffer.byteLength(val, "utf8") <= MAX_PASSWORD_BYTE_LENGTH,
        {
          message: `Password cannot exceed ${MAX_PASSWORD_BYTE_LENGTH} UTF-8 bytes.`,
        },
      ),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

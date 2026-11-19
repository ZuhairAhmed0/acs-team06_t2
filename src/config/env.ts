import "dotenv/config";
import { z } from "zod";

const postgresUrl = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, context) => {
    try {
      const url = new URL(value);

      if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid PostgreSQL URL scheme. Must be postgres: or postgresql:.",
        });
      }
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Malformed PostgreSQL connection URL.",
      });
    }
  });

export const envSchema = z.object({
  NODE_ENV: z.enum(["production", "development", "test"]).default("development"),
  APP_STAGE: z.enum(["production", "dev", "test"]).default("dev"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: postgresUrl,
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters long.")
    .default(
      process.env.NODE_ENV === "test"
        ? "test-session-secret-must-be-at-least-32-chars-long"
        : undefined as unknown as string,
    ),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
  CORS_ORIGIN: z
    .string()
    .trim()
    .optional()
    .refine(
      (origin) => !origin || origin !== "*",
      "Unrestricted wildcard CORS ('*') is not allowed for authenticated endpoints.",
    ),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnvironment(input: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(input);

  if (!result.success) {
    // Only report invalid configuration field names; NEVER expose raw values or credentials
    const invalidFields = result.error.issues
      .map((issue) => issue.path.join("."))
      .filter(Boolean)
      .join(", ");

    throw new Error(
      `Invalid environment configuration. Failed fields: ${invalidFields || "unknown"}`,
    );
  }

  return result.data;
}

export const env = parseEnvironment(process.env);

export const isProduction = () => env.NODE_ENV === "production";
export const isDevelopment = () => env.NODE_ENV === "development";
export const isTest = () => env.NODE_ENV === "test";

export default env;

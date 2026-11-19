import { describe, expect, it, vi } from "vitest";

import {
  Logger,
  redactSensitiveData,
} from "../src/shared/logging/logger.js";

describe("Safe Logging & Sensitive Data Redaction", () => {
  it("redacts sensitive fields like passwords, secrets, tokens, and bank credentials", () => {
    const rawPayload = {
      username: "driver_ahmed",
      password: "super_secret_password_123",
      token: "jwt.eyJhbGciOi...",
      authorization: "Bearer eyJhbGciOi...",
      cookie: "connect.sid=s%3A123456789",
      bank_account: "SDG1234567890",
      pin: "1234",
      cvv: "999",
      amount: "150.00", // Non-sensitive financial amount allowed in log
    };

    const redacted = redactSensitiveData(rawPayload) as typeof rawPayload;

    expect(redacted.username).toBe("driver_ahmed");
    expect(redacted.amount).toBe("150.00");
    expect(redacted.password).toBe("[REDACTED]");
    expect(redacted.token).toBe("[REDACTED]");
    expect(redacted.authorization).toBe("[REDACTED]");
    expect(redacted.cookie).toBe("[REDACTED]");
    expect(redacted.bank_account).toBe("[REDACTED]");
    expect(redacted.pin).toBe("[REDACTED]");
    expect(redacted.cvv).toBe("[REDACTED]");
  });

  it("masks credentials in PostgreSQL database connection strings", () => {
    const rawLog = "Connecting to postgresql://postgres:mySecretPass123@db.neon.tech/fuel_wallet";
    const redacted = redactSensitiveData(rawLog);

    expect(redacted).toBe("Connecting to postgresql://***:***@db.neon.tech/fuel_wallet");
    expect(redacted).not.toContain("mySecretPass123");
  });

  it("redacts nested objects and arrays recursively", () => {
    const complexData = {
      user: {
        profile: {
          name: "Station Attendant",
          passwordHash: "bcrypt_hash_12345",
        },
        tokens: ["token_abc", "token_xyz"],
      },
      requests: [
        {
          headers: {
            authorization: "Bearer secret-token",
          },
        },
      ],
    };

    const redacted = redactSensitiveData(complexData) as any;

    expect(redacted.user.profile.name).toBe("Station Attendant");
    expect(redacted.user.profile.passwordHash).toBe("[REDACTED]");
    expect(redacted.requests[0].headers.authorization).toBe("[REDACTED]");
  });

  it("handles circular references gracefully without throwing", () => {
    const circularObj: any = { name: "test" };
    circularObj.self = circularObj;

    expect(() => redactSensitiveData(circularObj)).not.toThrow();
    const redacted = redactSensitiveData(circularObj) as any;
    expect(redacted.self).toBe("[Circular]");
  });

  it("respects log level configuration", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const warnLogger = new Logger("warn");

    warnLogger.debug("Debug should be suppressed");
    warnLogger.info("Info should be suppressed");
    expect(logSpy).not.toHaveBeenCalled();

    warnLogger.error("Error should be logged", { code: "TEST_ERR" });
    expect(errorSpy).toHaveBeenCalledOnce();

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

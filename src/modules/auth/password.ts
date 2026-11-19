import bcrypt from "bcrypt";

export const BCRYPT_SALT_ROUNDS = 12;
export const MIN_PASSWORD_CHARS = 12;
export const MAX_PASSWORD_BYTE_LENGTH = 72;

/**
 * Validates password length and UTF-8 byte limits safely before passing to bcrypt.
 *
 * Security Guarantees:
 * - Requires at least 12 characters for strong entropy.
 * - Enforces bcrypt's hard 72-byte limit based on UTF-8 bytes to prevent silent truncation.
 */
export function validatePasswordRequirements(password: string): void {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_CHARS) {
    throw new Error(
      `Password must be at least ${MIN_PASSWORD_CHARS} characters long.`,
    );
  }

  const byteLength = Buffer.byteLength(password, "utf8");
  if (byteLength > MAX_PASSWORD_BYTE_LENGTH) {
    throw new Error(
      `Password exceeds maximum allowed limit of ${MAX_PASSWORD_BYTE_LENGTH} UTF-8 bytes.`,
    );
  }
}

/**
 * Asynchronously hashes a password using bcrypt with work factor 12.
 */
export async function hashPassword(password: string): Promise<string> {
  validatePasswordRequirements(password);
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

/**
 * Asynchronously verifies a plaintext password against a stored bcrypt hash.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  if (typeof password !== "string" || typeof storedHash !== "string") {
    return false;
  }
  return bcrypt.compare(password, storedHash);
}

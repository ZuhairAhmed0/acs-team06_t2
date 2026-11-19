/**
 * Financial Precision and Decimal String Arithmetic Utilities
 *
 * Domain Rules:
 * - Monetary amounts: PostgreSQL NUMERIC(18,2)
 * - Fuel quantities:  PostgreSQL NUMERIC(12,3)
 *
 * STRICT PRINCIPLE: Never use JavaScript Number (floating-point IEEE 754)
 * for monetary calculations, accounting ledger sums, or database storage.
 */

export const MONETARY_DECIMAL_PLACES = 2;
export const FUEL_QUANTITY_DECIMAL_PLACES = 3;

export const MONETARY_REGEX = /^-?\d+(\.\d{1,2})?$/;
export const FUEL_QUANTITY_REGEX = /^-?\d+(\.\d{1,3})?$/;

/**
 * Validates whether a value is a valid 2-decimal monetary string (NUMERIC(18,2)).
 */
export function isMonetaryString(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }
  return MONETARY_REGEX.test(value.trim());
}

/**
 * Validates whether a value is a valid 3-decimal fuel quantity string (NUMERIC(12,3)).
 */
export function isFuelQuantityString(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }
  return FUEL_QUANTITY_REGEX.test(value.trim());
}

/**
 * Parses a 2-decimal monetary string into an exact integer BigInt (representing cents/piastres).
 * E.g., "150.75" -> 15075n, "50" -> 5000n, "-12.5" -> -1250n.
 *
 * Guarantees zero floating-point arithmetic: pure string parsing and integer scaling.
 */
export function parseMonetaryToCents(amount: string): bigint {
  const trimmed = amount.trim();
  if (!isMonetaryString(trimmed)) {
    throw new Error(`Invalid monetary amount format: "${amount}". Expected NUMERIC(18,2).`);
  }

  const isNegative = trimmed.startsWith("-");
  const unsigned = isNegative ? trimmed.slice(1) : trimmed;

  const [integerPart, fractionalPart = ""] = unsigned.split(".");
  const paddedFractional = (fractionalPart + "00").slice(0, 2);

  const cents = BigInt(integerPart) * 100n + BigInt(paddedFractional);
  return isNegative ? -cents : cents;
}

/**
 * Formats a BigInt representing cents/piastres into a normalized 2-decimal monetary string.
 * E.g., 15075n -> "150.75", -500n -> "-5.00".
 */
export function formatCentsToMonetary(cents: bigint): string {
  const isNegative = cents < 0n;
  const absCents = isNegative ? -cents : cents;

  const integerPart = absCents / 100n;
  const fractionalPart = absCents % 100n;

  const fractionalStr = fractionalPart.toString().padStart(2, "0");
  const formatted = `${integerPart.toString()}.${fractionalStr}`;

  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Adds two monetary decimal strings without floating-point loss.
 * E.g., addMonetary("0.10", "0.20") === "0.30" (never 0.30000000000000004).
 */
export function addMonetary(a: string, b: string): string {
  const sumCents = parseMonetaryToCents(a) + parseMonetaryToCents(b);
  return formatCentsToMonetary(sumCents);
}

/**
 * Subtracts monetary decimal string `b` from `a` without floating-point loss.
 */
export function subtractMonetary(a: string, b: string): string {
  const diffCents = parseMonetaryToCents(a) - parseMonetaryToCents(b);
  return formatCentsToMonetary(diffCents);
}

/**
 * Compares two monetary decimal strings.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 */
export function compareMonetary(a: string, b: string): number {
  const aCents = parseMonetaryToCents(a);
  const bCents = parseMonetaryToCents(b);
  if (aCents < bCents) return -1;
  if (aCents > bCents) return 1;
  return 0;
}

export function isZeroMonetary(amount: string): boolean {
  return parseMonetaryToCents(amount) === 0n;
}

export function isPositiveMonetary(amount: string): boolean {
  return parseMonetaryToCents(amount) > 0n;
}

/**
 * Multiplies a 3-decimal fuel quantity (NUMERIC(12,3)) by a 2-decimal unit price (NUMERIC(18,2)),
 * and rounds the result to 2 decimal places using HALF_UP rounding.
 *
 * Guarantees zero floating point error by integer scaling:
 * - quantity is scaled by 1,000 (3 decimal places) -> q
 * - unitPrice is scaled by 100 (2 decimal places) -> p
 * - product = q * p (scaled by 100,000, i.e. 5 decimal places)
 *
 * To round to cents (2 decimal places), we divide by 1,000:
 * - quotient = product / 1000n
 * - remainder = product % 1000n
 * - If remainder >= 500n, quotient += 1n (HALF_UP for positive amounts)
 */
export function multiplyFuelPrice(quantity: string, unitPrice: string): string {
  const trimmedQ = quantity.trim();
  const trimmedP = unitPrice.trim();

  if (!isFuelQuantityString(trimmedQ)) {
    throw new Error(`Invalid fuel quantity format: "${quantity}". Expected NUMERIC(12,3).`);
  }
  if (!isMonetaryString(trimmedP)) {
    throw new Error(`Invalid unit price format: "${unitPrice}". Expected NUMERIC(18,2).`);
  }

  const [qInt, qFrac = ""] = trimmedQ.split(".");
  const paddedQFrac = (qFrac + "000").slice(0, 3);
  const qBig = BigInt(qInt) * 1000n + BigInt(paddedQFrac);

  const pBig = parseMonetaryToCents(trimmedP);

  const product = qBig * pBig;
  const isNegative = product < 0n;
  const absProduct = isNegative ? -product : product;

  let cents = absProduct / 1000n;
  const remainder = absProduct % 1000n;

  if (remainder >= 500n) {
    cents += 1n;
  }

  return formatCentsToMonetary(isNegative ? -cents : cents);
}

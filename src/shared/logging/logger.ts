export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const SENSITIVE_KEY_REGEX =
  /(?:password|passwd|secret|token|authorization|cookie|session|bank_?account|account_?number|card_?number|cvv|pin|private_?key|api_?key|database_?url)/i;

const DATABASE_URL_CREDENTIAL_REGEX =
  /(postgres(?:ql)?:\/\/)([^:@\s]+):([^@\s]+)@/gi;

const BEARER_TOKEN_REGEX = /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;

/**
 * Deeply redacts sensitive keys and values from arbitrary data structures.
 *
 * Guarantees:
 * - Redacts passwords, tokens, cookies, authorization headers, bank credentials, etc.
 * - Mask credentials in database connection URLs.
 * - Prevents circular reference crashes.
 */
export function redactSensitiveData<T>(data: T, visited = new WeakSet()): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === "string") {
    return data
      .replace(DATABASE_URL_CREDENTIAL_REGEX, "$1***:***@")
      .replace(BEARER_TOKEN_REGEX, "$1[REDACTED]") as unknown as T;
  }

  if (typeof data !== "object") {
    return data;
  }

  if (visited.has(data as object)) {
    return "[Circular]" as unknown as T;
  }
  visited.add(data as object);

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item, visited)) as unknown as T;
  }

  if (data instanceof Error) {
    const errorObj: Record<string, unknown> = {
      name: data.name,
      message: redactSensitiveData(data.message, visited),
    };
    if (process.env.NODE_ENV !== "production" && data.stack) {
      errorObj.stack = redactSensitiveData(data.stack, visited);
    }
    return errorObj as unknown as T;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = redactSensitiveData(value, visited);
    }
  }

  return result as T;
}

export interface StructuredLogRecord {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  [key: string]: unknown;
}

export class Logger {
  private level: LogLevel;

  public constructor(level: LogLevel = "info") {
    this.level = level;
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  public getLevel(): LogLevel {
    return this.level;
  }

  private shouldLog(targetLevel: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[targetLevel] >= LOG_LEVEL_PRIORITY[this.level];
  }

  private write(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const safeContext = context ? redactSensitiveData(context) : undefined;
    const logRecord: StructuredLogRecord = {
      timestamp: new Date().toISOString(),
      level,
      message: typeof message === "string" ? redactSensitiveData(message) : message,
      ...(safeContext ?? {}),
    };

    const serialized = JSON.stringify(logRecord);

    if (level === "error") {
      console.error(serialized);
    } else if (level === "warn") {
      console.warn(serialized);
    } else {
      console.log(serialized);
    }
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    this.write("debug", message, context);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.write("info", message, context);
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.write("warn", message, context);
  }

  public error(message: string, context?: Record<string, unknown>): void {
    this.write("error", message, context);
  }
}

export const logger = new Logger(
  (process.env.LOG_LEVEL as LogLevel) || "info",
);

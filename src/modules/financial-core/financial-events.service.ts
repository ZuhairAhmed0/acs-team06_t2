import { db } from "../../db/client.js";
import {
  financialTransactionEvents,
} from "../../db/schema/financial-transaction-events.js";
import type { DatabaseTransaction, TransactionContext } from "../../db/transaction.js";

export interface RecordTransactionEventParams {
  transactionId: string;
  eventType: string;
  previousStatus?: "PENDING" | "PROCESSING" | "COMPLETED" | "REJECTED" | "FAILED" | "CANCELLED" | null;
  newStatus?: "PENDING" | "PROCESSING" | "COMPLETED" | "REJECTED" | "FAILED" | "CANCELLED" | null;
  previousExecutionStatus?:
    | "NOT_REQUIRED"
    | "NOT_STARTED"
    | "IN_PROGRESS"
    | "SUCCEEDED"
    | "FAILED"
    | "UNKNOWN"
    | null;
  newExecutionStatus?:
    | "NOT_REQUIRED"
    | "NOT_STARTED"
    | "IN_PROGRESS"
    | "SUCCEEDED"
    | "FAILED"
    | "UNKNOWN"
    | null;
  actorUserId?: string | null;
  idempotencyKey?: string | null;
  requestHash?: string | null;
  metadata?: Record<string, unknown>;
}

export class FinancialEventsService {
  /**
   * Sanitizes event metadata to ensure no passwords, tokens, cookies, or secrets are recorded.
   */
  private sanitizeMetadata(data?: Record<string, unknown>): Record<string, unknown> {
    if (!data) return {};

    const sensitiveKeyPattern = /password|secret|token|cookie|auth|credential|pin|cvv/i;
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      if (sensitiveKeyPattern.test(key)) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeMetadata(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Appends an immutable audit event to financial_transaction_events.
   */
  async recordEvent(
    params: RecordTransactionEventParams,
    tx: TransactionContext = db,
  ) {
    const cleanMetadata = this.sanitizeMetadata(params.metadata);

    const [event] = await tx
      .insert(financialTransactionEvents)
      .values({
        transactionId: params.transactionId,
        eventType: params.eventType,
        previousStatus: params.previousStatus ?? null,
        newStatus: params.newStatus ?? null,
        previousExecutionStatus: params.previousExecutionStatus ?? null,
        newExecutionStatus: params.newExecutionStatus ?? null,
        actorUserId: params.actorUserId ?? null,
        idempotencyKey: params.idempotencyKey ?? null,
        requestHash: params.requestHash ?? null,
        metadata: cleanMetadata,
      })
      .returning();

    return event!;
  }
}

export const financialEventsService = new FinancialEventsService();

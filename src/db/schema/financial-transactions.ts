import { sql } from "drizzle-orm";
import {
  char,
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { bankAccounts } from "./bank-accounts.js";
import {
  executionStatusEnum,
  financialTransactionStatusEnum,
  financialTransactionTypeEnum,
} from "./enums.js";
import { financialAccounts } from "./financial-accounts.js";
import { stations } from "./stations.js";
import { users } from "./users.js";

export const financialTransactions = pgTable(
  "financial_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionType: financialTransactionTypeEnum("transaction_type").notNull(),
    status: financialTransactionStatusEnum("status").notNull().default("PENDING"),
    executionStatus: executionStatusEnum("execution_status")
      .notNull()
      .default("NOT_REQUIRED"),
    requestedAmount: numeric("requested_amount", {
      precision: 18,
      scale: 2,
      mode: "string",
    })
      .notNull(),
    amount: numeric("amount", { precision: 18, scale: 2, mode: "string" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    stationId: uuid("station_id").references(() => stations.id, { onDelete: "restrict" }),
    sourceStationId: uuid("source_station_id").references(() => stations.id, {
      onDelete: "restrict",
    }),
    destinationStationId: uuid("destination_station_id").references(() => stations.id, {
      onDelete: "restrict",
    }),
    bankAccountId: uuid("bank_account_id").references(() => bankAccounts.id, {
      onDelete: "restrict",
    }),
    submittedBankReference: varchar("submitted_bank_reference", { length: 150 }),
    outgoingBankReference: varchar("outgoing_bank_reference", { length: 150 }),
    incomingBankReference: varchar("incoming_bank_reference", { length: 150 }),
    reversalOfTransactionId: uuid("reversal_of_transaction_id").references(
      (): AnyPgColumn => financialTransactions.id,
      { onDelete: "restrict" },
    ),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    requestHash: char("request_hash", { length: 64 }),
    holdAccountId: uuid("hold_account_id").references(() => financialAccounts.id, {
      onDelete: "restrict",
    }),
    holdAmount: numeric("hold_amount", { precision: 18, scale: 2, mode: "string" })
      .notNull()
      .default("0"),
    capturedAmount: numeric("captured_amount", {
      precision: 18,
      scale: 2,
      mode: "string",
    })
      .notNull()
      .default("0"),
    releasedAmount: numeric("released_amount", {
      precision: 18,
      scale: 2,
      mode: "string",
    })
      .notNull()
      .default("0"),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    executionStartedAt: timestamp("execution_started_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    processedByUserId: uuid("processed_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    check("financial_transactions_requested_amount_positive", sql`${table.requestedAmount} > 0`),
    check(
      "financial_transactions_amount_positive_when_present",
      sql`${table.amount} IS NULL OR ${table.amount} > 0`,
    ),
    check(
      "financial_transactions_hold_amounts_non_negative",
      sql`${table.holdAmount} >= 0 AND ${table.capturedAmount} >= 0 AND ${table.releasedAmount} >= 0`,
    ),
    check(
      "financial_transactions_hold_amounts_within_hold",
      sql`${table.capturedAmount} <= ${table.holdAmount} AND ${table.capturedAmount} + ${table.releasedAmount} <= ${table.holdAmount}`,
    ),
    check(
      "financial_transactions_hold_account_presence",
      sql`(${table.holdAmount} = 0 AND ${table.holdAccountId} IS NULL) OR (${table.holdAmount} > 0 AND ${table.holdAccountId} IS NOT NULL)`,
    ),
    check(
      "financial_transactions_hold_backed_types",
      sql`
        (${table.transactionType} IN ('FUEL_PURCHASE', 'WITHDRAWAL', 'SETTLEMENT')
          AND ${table.holdAmount} = ${table.requestedAmount}
          AND ${table.holdAccountId} IS NOT NULL)
        OR (${table.transactionType} NOT IN ('FUEL_PURCHASE', 'WITHDRAWAL', 'SETTLEMENT')
          AND ${table.holdAmount} = 0
          AND ${table.holdAccountId} IS NULL)
      `,
    ),
    check(
      "financial_transactions_completed_amount_present",
      sql`${table.status} <> 'COMPLETED' OR ${table.amount} IS NOT NULL`,
    ),
    check(
      "financial_transactions_completed_holds_resolved",
      sql`${table.status} <> 'COMPLETED' OR ${table.holdAmount} = 0 OR ${table.capturedAmount} + ${table.releasedAmount} = ${table.holdAmount}`,
    ),
    check(
      "financial_transactions_unsuccessful_holds_released",
      sql`${table.status} NOT IN ('REJECTED', 'FAILED', 'CANCELLED') OR (${table.capturedAmount} = 0 AND ${table.releasedAmount} = ${table.holdAmount})`,
    ),
    check(
      "financial_transactions_unknown_holds_retained",
      sql`${table.executionStatus} <> 'UNKNOWN' OR ${table.holdAmount} = 0 OR (${table.capturedAmount} = 0 AND ${table.releasedAmount} = 0)`,
    ),
    check(
      "financial_transactions_actual_amount_within_request",
      sql`${table.transactionType} NOT IN ('FUEL_PURCHASE', 'WITHDRAWAL', 'SETTLEMENT') OR ${table.amount} IS NULL OR ${table.amount} <= ${table.requestedAmount}`,
    ),
    check(
      "financial_transactions_completed_fuel_purchase_capture",
      sql`${table.transactionType} <> 'FUEL_PURCHASE' OR ${table.status} <> 'COMPLETED' OR (${table.amount} <= ${table.requestedAmount} AND ${table.capturedAmount} = ${table.amount} AND ${table.releasedAmount} = ${table.holdAmount} - ${table.amount})`,
    ),
    check(
      "financial_transactions_completed_outgoing_full_capture",
      sql`${table.transactionType} NOT IN ('WITHDRAWAL', 'SETTLEMENT') OR ${table.status} <> 'COMPLETED' OR (${table.amount} = ${table.requestedAmount} AND ${table.capturedAmount} = ${table.requestedAmount} AND ${table.releasedAmount} = 0)`,
    ),
    check(
      "financial_transactions_required_references",
      sql`
        (${table.transactionType} = 'TOP_UP' AND ${table.userId} IS NOT NULL AND ${table.bankAccountId} IS NOT NULL)
        OR (${table.transactionType} = 'WITHDRAWAL' AND ${table.userId} IS NOT NULL AND ${table.bankAccountId} IS NOT NULL)
        OR (${table.transactionType} = 'ALLOCATION' AND ${table.userId} IS NOT NULL AND ${table.stationId} IS NOT NULL)
        OR (${table.transactionType} = 'DEALLOCATION' AND ${table.userId} IS NOT NULL AND ${table.stationId} IS NOT NULL)
        OR (${table.transactionType} = 'TRANSFER' AND ${table.userId} IS NOT NULL AND ${table.sourceStationId} IS NOT NULL AND ${table.destinationStationId} IS NOT NULL AND ${table.sourceStationId} <> ${table.destinationStationId})
        OR (${table.transactionType} = 'FUEL_PURCHASE' AND ${table.userId} IS NOT NULL AND ${table.stationId} IS NOT NULL)
        OR (${table.transactionType} = 'SETTLEMENT' AND ${table.stationId} IS NOT NULL AND ${table.bankAccountId} IS NOT NULL)
        OR (${table.transactionType} = 'REVERSAL' AND ${table.reversalOfTransactionId} IS NOT NULL)
      `,
    ),
    check(
      "financial_transactions_reversal_reference_only_for_reversals",
      sql`(${table.transactionType} = 'REVERSAL' AND ${table.reversalOfTransactionId} IS NOT NULL) OR (${table.transactionType} <> 'REVERSAL' AND ${table.reversalOfTransactionId} IS NULL)`,
    ),
    uniqueIndex("financial_transactions_creator_idempotency_key_unique")
      .on(table.createdByUserId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    uniqueIndex("financial_transactions_completed_reversal_unique")
      .on(table.reversalOfTransactionId)
      .where(
        sql`${table.transactionType} = 'REVERSAL' AND ${table.status} = 'COMPLETED' AND ${table.reversalOfTransactionId} IS NOT NULL`,
      ),
    index("financial_transactions_user_created_at_idx").on(table.userId, table.createdAt),
    index("financial_transactions_station_created_at_idx").on(table.stationId, table.createdAt),
    index("financial_transactions_type_status_idx").on(table.transactionType, table.status),
    index("financial_transactions_execution_status_idx").on(table.executionStatus),
    index("financial_transactions_hold_account_status_idx").on(table.holdAccountId, table.status),
    index("financial_transactions_submitted_bank_reference_idx").on(
      table.submittedBankReference,
    ),
    index("financial_transactions_outgoing_bank_reference_idx").on(table.outgoingBankReference),
    index("financial_transactions_incoming_bank_reference_idx").on(table.incomingBankReference),
    index("financial_transactions_reversal_of_idx").on(table.reversalOfTransactionId),
  ],
);

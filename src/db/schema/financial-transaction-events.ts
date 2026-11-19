import { sql } from "drizzle-orm";
import {
  char,
  index,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  executionStatusEnum,
  financialTransactionStatusEnum,
} from "./enums.js";
import { financialTransactions } from "./financial-transactions.js";
import { users } from "./users.js";

export const financialTransactionEvents = pgTable(
  "financial_transaction_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => financialTransactions.id, { onDelete: "restrict" }),
    eventType: varchar("event_type", { length: 60 }).notNull(),
    previousStatus: financialTransactionStatusEnum("previous_status"),
    newStatus: financialTransactionStatusEnum("new_status"),
    previousExecutionStatus: executionStatusEnum("previous_execution_status"),
    newExecutionStatus: executionStatusEnum("new_execution_status"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    requestHash: char("request_hash", { length: 64 }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("financial_transaction_events_transaction_created_at_idx").on(
      table.transactionId,
      table.createdAt,
    ),
    index("financial_transaction_events_actor_created_at_idx").on(
      table.actorUserId,
      table.createdAt,
    ),
  ],
);

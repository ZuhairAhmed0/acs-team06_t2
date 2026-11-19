import { sql } from "drizzle-orm";
import {
  check,
  index,
  numeric,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { financialEntryTypeEnum } from "./enums.js";
import { financialAccounts } from "./financial-accounts.js";
import { financialTransactions } from "./financial-transactions.js";

export const financialEntries = pgTable(
  "financial_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => financialTransactions.id, { onDelete: "restrict" }),
    financialAccountId: uuid("financial_account_id")
      .notNull()
      .references(() => financialAccounts.id, { onDelete: "restrict" }),
    entryType: financialEntryTypeEnum("entry_type").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2, mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("financial_entries_amount_positive", sql`${table.amount} > 0`),
    index("financial_entries_transaction_id_idx").on(table.transactionId),
    index("financial_entries_financial_account_id_idx").on(table.financialAccountId),
  ],
);

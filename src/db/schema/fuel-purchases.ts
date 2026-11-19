import { sql } from "drizzle-orm";
import {
  check,
  numeric,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { financialTransactions } from "./financial-transactions.js";
import { users } from "./users.js";

export const fuelPurchases = pgTable(
  "fuel_purchases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    financialTransactionId: uuid("financial_transaction_id")
      .notNull()
      .unique()
      .references(() => financialTransactions.id, { onDelete: "restrict" }),
    fuelType: varchar("fuel_type", { length: 30 }).notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 3, mode: "string" }).notNull(),
    unitPrice: numeric("unit_price", { precision: 18, scale: 2, mode: "string" }).notNull(),
    attendantId: uuid("attendant_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("fuel_purchases_quantity_positive", sql`${table.quantity} > 0`),
    check("fuel_purchases_unit_price_positive", sql`${table.unitPrice} > 0`),
  ],
);

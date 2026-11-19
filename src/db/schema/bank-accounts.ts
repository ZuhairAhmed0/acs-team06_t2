import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { stations } from "./stations.js";
import { users } from "./users.js";

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bankName: varchar("bank_name", { length: 100 }).notNull(),
    accountNumber: varchar("account_number", { length: 50 }).notNull(),
    accountHolderName: varchar("account_holder_name", { length: 150 }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    stationId: uuid("station_id").references(() => stations.id, { onDelete: "restrict" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "bank_accounts_exactly_one_owner",
      sql`(${table.userId} IS NOT NULL AND ${table.stationId} IS NULL) OR (${table.userId} IS NULL AND ${table.stationId} IS NOT NULL)`,
    ),
    uniqueIndex("bank_accounts_primary_user_unique")
      .on(table.userId)
      .where(sql`${table.userId} IS NOT NULL AND ${table.isPrimary} = true AND ${table.isActive} = true`),
    uniqueIndex("bank_accounts_primary_station_unique")
      .on(table.stationId)
      .where(sql`${table.stationId} IS NOT NULL AND ${table.isPrimary} = true AND ${table.isActive} = true`),
    index("bank_accounts_user_id_idx").on(table.userId),
    index("bank_accounts_station_id_idx").on(table.stationId),
  ],
);

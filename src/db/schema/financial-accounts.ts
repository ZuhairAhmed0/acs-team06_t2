import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { financialAccountTypeEnum } from "./enums.js";
import { stations } from "./stations.js";
import { users } from "./users.js";

export const financialAccounts = pgTable(
  "financial_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountType: financialAccountTypeEnum("account_type").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    stationId: uuid("station_id").references(() => stations.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "financial_accounts_ownership_valid",
      sql`
        (${table.accountType} = 'PLATFORM_CASH' AND ${table.userId} IS NULL AND ${table.stationId} IS NULL)
        OR (${table.accountType} = 'USER_AVAILABLE' AND ${table.userId} IS NOT NULL AND ${table.stationId} IS NULL)
        OR (${table.accountType} = 'USER_ALLOCATED' AND ${table.userId} IS NOT NULL AND ${table.stationId} IS NOT NULL)
        OR (${table.accountType} = 'STATION_PAYABLE' AND ${table.userId} IS NULL AND ${table.stationId} IS NOT NULL)
      `,
    ),
    uniqueIndex("financial_accounts_platform_cash_unique")
      .on(table.accountType)
      .where(sql`${table.accountType} = 'PLATFORM_CASH'`),
    uniqueIndex("financial_accounts_user_available_unique")
      .on(table.userId)
      .where(sql`${table.accountType} = 'USER_AVAILABLE'`),
    uniqueIndex("financial_accounts_user_station_allocated_unique")
      .on(table.userId, table.stationId)
      .where(sql`${table.accountType} = 'USER_ALLOCATED'`),
    uniqueIndex("financial_accounts_station_payable_unique")
      .on(table.stationId)
      .where(sql`${table.accountType} = 'STATION_PAYABLE'`),
  ],
);

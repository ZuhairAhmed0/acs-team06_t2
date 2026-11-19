import { sql } from "drizzle-orm";
import {
  check,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import {
  stationMemberRoleEnum,
  stationMemberStatusEnum,
  stationStatusEnum,
} from "./enums.js";
import { users } from "./users.js";

export const stations = pgTable(
  "stations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 150 }).notNull(),
    address: text("address").notNull(),
    minimumSettlementAmount: numeric("minimum_settlement_amount", {
      precision: 18,
      scale: 2,
      mode: "string",
    })
      .notNull(),
    status: stationStatusEnum("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "stations_minimum_settlement_amount_positive",
      sql`${table.minimumSettlementAmount} > 0`,
    ),
  ],
);

export const stationMembers = pgTable(
  "station_members",
  {
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: stationMemberRoleEnum("role").notNull(),
    status: stationMemberStatusEnum("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.stationId, table.userId] }),
    index("station_members_user_id_idx").on(table.userId),
    index("station_members_station_status_idx").on(table.stationId, table.status),
  ],
);

export const stationFuelPrices = pgTable(
  "station_fuel_prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "restrict" }),
    fuelType: varchar("fuel_type", { length: 30 }).notNull(),
    pricePerLiter: numeric("price_per_liter", {
      precision: 18,
      scale: 2,
      mode: "string",
    })
      .notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("station_fuel_prices_price_positive", sql`${table.pricePerLiter} > 0`),
    check(
      "station_fuel_prices_valid_range",
      sql`${table.validUntil} IS NULL OR ${table.validUntil} > ${table.validFrom}`,
    ),
    index("station_fuel_prices_station_fuel_valid_from_idx").on(
      table.stationId,
      table.fuelType,
      table.validFrom,
    ),
  ],
);

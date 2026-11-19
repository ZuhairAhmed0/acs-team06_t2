import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { systemRoleEnum, userStatusEnum } from "./enums.js";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  fullName: varchar("full_name", { length: 150 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  systemRole: systemRoleEnum("system_role").notNull().default("USER"),
  status: userStatusEnum("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

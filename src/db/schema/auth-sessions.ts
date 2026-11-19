import { sql } from "drizzle-orm";
import { index, json, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const authSessions = pgTable(
  "auth_sessions",
  {
    sid: varchar("sid", { length: 255 }).primaryKey().notNull(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
  },
  (table) => [
    index("auth_sessions_expire_idx").on(table.expire),
    index("auth_sessions_user_id_idx").on(sql`(${table.sess}->>'userId')`),
  ],
);

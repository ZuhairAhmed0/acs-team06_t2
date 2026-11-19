import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { prewarmDns } from "../config/dns.js";
import { env } from "../config/env.js";
import * as schema from "./schema/index.js";

const { Pool, types } = pg;

// Enforce that PostgreSQL NUMERIC (OID 1700) is returned as a string.
// Never convert financial or quantity NUMERIC values to JavaScript floating point numbers.
types.setTypeParser(1700, (val: string) => val);

function getConnectionString(): string {
  const url = env.DATABASE_URL;
  if (url.includes("sslmode=require") && !url.includes("uselibpqcompat=")) {
    return url.includes("?") ? `${url}&uselibpqcompat=true` : `${url}?uselibpqcompat=true`;
  }
  return url;
}

export const pool = new Pool({
  connectionString: getConnectionString(),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Prewarm DNS resolution in the background
void prewarmDns(env.DATABASE_URL);

export const db = drizzle({ client: pool, schema });

export async function checkDatabaseReadiness(): Promise<void> {
  await pool.query("SELECT 1");
}

export async function closeDatabasePool(): Promise<void> {
  await pool.end();
}

import connectPgSimple from "connect-pg-simple";
import session, { type Store } from "express-session";

import { env } from "../config/env.js";
import { pool } from "../db/client.js";

export const SESSION_COOKIE_NAME = "wifuel.sid";
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days in seconds

const PgSession = connectPgSimple(session);

/**
 * Creates the production PostgreSQL-backed session store using the shared database pool.
 *
 * Guarantees:
 * - Table name: "auth_sessions"
 * - createTableIfMissing: false (migrations own the schema)
 * - Automatic expired-session pruning every 15 minutes
 * - Uses existing PostgreSQL Pool; never creates an unnecessary second pool.
 */
export function createPgSessionStore(): Store {
  return new PgSession({
    pool,
    tableName: "auth_sessions",
    createTableIfMissing: false,
    pruneSessionInterval: 15 * 60, // 15 minutes
    ttl: SESSION_TTL_SECONDS,
  });
}

export interface SessionMiddlewareOptions {
  store?: Store;
}

/**
 * Configures express-session middleware.
 * Uses PostgreSQL store by default. Never uses MemoryStore in production.
 */
export function createSessionMiddleware(options: SessionMiddlewareOptions = {}) {
  const store = options.store ?? createPgSessionStore();

  return session({
    name: SESSION_COOKIE_NAME,
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    store,
    cookie: {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_MS,
    },
  });
}

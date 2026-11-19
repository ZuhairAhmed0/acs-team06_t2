import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";

import { db } from "./client.js";
import * as schema from "./schema/index.js";

export type DatabaseInstance = typeof db;
export type DatabaseTransaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export type TransactionContext = DatabaseInstance | DatabaseTransaction;

/**
 * Executes a callback inside an atomic PostgreSQL database transaction using Drizzle ORM.
 *
 * Technical Guarantees:
 * 1. Atomic Execution: All database writes succeed together or roll back on failure.
 * 2. Automatic Rollback: If the callback throws or rejects, Drizzle issues a ROLLBACK to PostgreSQL.
 * 3. Error Propagation: The original application error is rethrown without loss of context or wrapping.
 * 4. TypeScript Inference: The transaction object `tx` is strongly typed with all schema tables and relations.
 * 5. Nesting / Participation: If an existing transaction `existingTx` is provided, the callback participates in it.
 *
 * =========================================================================================
 * ARCHITECTURAL CONVENTION FOR FUTURE FINANCIAL OPERATIONS (Phase 4 & Phase 5)
 * =========================================================================================
 *
 * 1. Single Transaction Boundary:
 *    Any operation that affects financial balances (top-up verification, allocation,
 *    fuel purchase hold/capture/release, withdrawal, station settlement, or reversal)
 *    MUST execute all of its operations within a single database transaction:
 *    - Account reads and row locks
 *    - Double-entry ledger writes
 *    - Hold creations or releases
 *    - Transaction state transitions
 *    - Event log recordings
 *
 * 2. Pessimistic Row Locking (`SELECT ... FOR UPDATE`):
 *    To prevent race conditions, concurrent balance deductions, or double-spending,
 *    financial account rows MUST be locked before reading balances:
 *      e.g. `await tx.select().from(financialAccounts).where(eq(...)).for("update");`
 *    or raw SQL fragment `sql`SELECT ... FOR UPDATE``.
 *
 * 3. No Application-Level Lock Substitutes:
 *    In-memory mutexes, Node.js process locks, or Redis distributed locks must NEVER
 *    be used as a substitute for PostgreSQL transaction isolation and row-level locks.
 */
export async function withTransaction<T>(
  callback: (tx: DatabaseTransaction) => Promise<T>,
  existingTx?: DatabaseTransaction,
): Promise<T> {
  if (existingTx) {
    return callback(existingTx);
  }

  return db.transaction(async (tx) => {
    return callback(tx as DatabaseTransaction);
  });
}

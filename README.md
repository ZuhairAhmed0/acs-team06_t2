# وين الوقود؟ (Where Is the Fuel?)

Backend foundation for a Sudanese fuel wallet and station-settlement platform.

The current phases establish:
- Express 5 application shell and graceful shutdown lifecycle
- Centralized typed environment validation (Zod)
- PostgreSQL connectivity via connection pooling and Drizzle ORM
- Schema and migrations for ten core database tables with custom SQL integrity constraints
- Request correlation with cryptographically secure Request IDs (`X-Request-ID`)
- Structured logging with deep sensitive data redaction
- Reusable Zod-based request validation (`validateRequest`)
- Centralized error handling and PostgreSQL error mapping
- Safe financial precision utilities and transaction boundary conventions
- Liveness and readiness health checks with test coverage
- Server-side session-based authentication (PostgreSQL session store, no JWTs)
- Synchronizer CSRF protection and origin validation
- Strict authorization model separating system roles and station memberships
- Protected user profile endpoint and CLI administrator provisioning

Financial business workflows, authentication, and user-facing modules are intentionally separated and belong to subsequent phases.

---

## Requirements

- Node.js 24.x (see `.nvmrc`)
- npm
- PostgreSQL (for readiness check and migration execution)

---

## Setup

```bash
nvm use
npm install
cp .env.example .env
```

Configure `DATABASE_URL` in `.env` to your PostgreSQL connection URL. Never commit `.env` or expose database credentials.

---

## Available Commands

```bash
npm run dev         # Starts the development server with tsx watch
npm run build       # Compiles TypeScript to dist/
npm start           # Runs compiled production server from dist/index.js
npm run typecheck   # Runs strict TypeScript type checking
npm test            # Runs full test suite via Vitest
npm run test:watch  # Runs tests in watch mode
npm run db:generate # Generates Drizzle schema migrations
npm run db:migrate  # Executes pending database migrations
npm run db:check    # Verifies Drizzle migrations against schema
```

---

## Endpoints

```bash
curl http://localhost:3000/api/v1/health
curl http://localhost:3000/api/v1/ready
```

- `GET /api/v1/health`: Liveness probe. Returns `200 OK` without contacting PostgreSQL.
- `GET /api/v1/ready`: Readiness probe. Executes a lightweight `SELECT 1` query. Returns `200 OK` when PostgreSQL is connected or `503 Service Unavailable` with a structured error when unreachable.

---

## Core Backend Infrastructure (Phase 3)

### 1. Request Lifecycle

```
[Incoming Request]
       │
       ▼
[1. Request ID Middleware] ──► Generates secure UUID or validates safe X-Request-ID
       │
       ▼
[2. Security Headers]      ──► Helmet HTTP protections (x-powered-by disabled)
       │
       ▼
[3. CORS]                  ──► Restrictive origin checks (no wildcard on auth endpoints)
       │
       ▼
[4. Body Parser]           ──► Express JSON parser (100kb payload limit)
       │
       ▼
[5. Request Logger]        ──► Logs [:request-id] :method :path :status - :response-time
       │
       ▼
[6. Routes & Validation]   ──► validateRequest({ body, params, query })
       │
       ├── (Validation Error) ──► Handled by Central Error Handler (400 VALIDATION_ERROR)
       ▼
[7. Route Controllers]     ──► Executes business logic, accessing typed validated data
       │
       ▼
[8. Not Found Handler]     ──► Catches unmatched routes -> 404 NOT_FOUND
       │
       ▼
[9. Central Error Handler] ──► Formats uniform error responses with requestId & safe logs
```

### 2. Request Tracking (`X-Request-ID`)

Every incoming request is assigned a cryptographically secure UUID (`crypto.randomUUID()`) or a validated external correlation ID (`^[a-zA-Z0-9_-]{8,64}$`).

- Attached to `req.id` and `res.locals.requestId`.
- Sent in the `X-Request-ID` response header.
- Included in all error response payloads.
- Included in structured logs for distributed tracing.

### 3. Request Validation Middleware

Reusable Zod validation for body, route parameters, and query parameters:

```typescript
import { z } from "zod";
import { validateRequest, getValidatedData } from "../middleware/validate-request.js";

const transferSchema = z.object({
  stationId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

router.post(
  "/transfers",
  validateRequest({ body: transferSchema }),
  (req, res) => {
    const { body } = getValidatedData<z.infer<typeof transferSchema>>(res);
    // body is strongly typed and guaranteed valid
  }
);
```

- Invalid payloads are rejected before the controller executes.
- Preserves coerced and validated types in `res.locals.validated`.
- Never leaks internal stack traces or database schema details in error messages.

### 4. Centralized Error Handling

All errors produce a consistent response envelope:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "requestId": "a9e6bb07-f98b-4a55-8ec1-d576a80d463b"
  }
}
```

Standard error classes (`src/shared/errors/app-error.ts`):
- `BadRequestError` (`400 BAD_REQUEST`)
- `ValidationError` (`400 VALIDATION_ERROR`)
- `UnauthorizedError` (`401 UNAUTHORIZED`)
- `ForbiddenError` (`403 FORBIDDEN`)
- `NotFoundError` (`404 NOT_FOUND`)
- `ConflictError` (`409 CONFLICT`)
- `UnprocessableContentError` (`422 UNPROCESSABLE_CONTENT`)
- `TooManyRequestsError` (`429 TOO_MANY_REQUESTS`)
- `InternalServerError` (`500 INTERNAL_SERVER_ERROR`)
- `ServiceUnavailableError` (`503 SERVICE_UNAVAILABLE`)

**PostgreSQL Error Mapping (`db-error-mapper.ts`):**
Conservative mapping of database constraint errors into client-safe errors:
- `23505` (unique_violation) ──► `409 CONFLICT`
- `23503` (foreign_key_violation) ──► `409 CONFLICT`
- `23514` (check_violation) ──► `422 UNPROCESSABLE_CONTENT`
- `40001` (serialization_failure) ──► `409 CONFLICT` (retryable)
- `08006` / `57P01` (connection failure / shutdown) ──► `503 SERVICE_UNAVAILABLE`
- All other unexpected DB errors ──► `500 INTERNAL_SERVER_ERROR` (details logged privately, hidden from client)

### 5. Safe Logging Policy

Structured JSON logger with deep sensitive data redaction:
- **Redacted fields:** passwords, tokens, API keys, cookies, session IDs, authorization headers, bank account numbers, PINs, CVVs.
- **Connection strings:** Database credentials in URLs (e.g. `postgresql://user:pass@host/db`) are automatically masked to `***:***`.
- **Payloads:** Raw financial request bodies are not logged by default.

### 6. Database Client & Transactions

- Centralized PostgreSQL connection pool in `src/db/client.ts`.
- Node-postgres NUMERIC parser (OID 1700) is enforced to return decimal strings, preventing JavaScript floating-point conversions.
- Graceful shutdown handles `SIGINT` and `SIGTERM` by closing HTTP listeners and the database pool.

#### Transaction Conventions (`src/db/transaction.ts`):

All balance-affecting operations (top-ups, allocations, fuel purchases, withdrawals, settlements, reversals) MUST execute within a single atomic database transaction using `withTransaction`:

```typescript
import { withTransaction } from "../db/transaction.js";

await withTransaction(async (tx) => {
  // 1. Lock financial accounts pessimistically (SELECT ... FOR UPDATE)
  // 2. Validate sufficient balance
  // 3. Insert append-only double-entry ledger rows
  // 4. Update transaction state & emit audit events
});
```

- **Atomicity:** All writes commit together or roll back on error.
- **Row Locking:** Balances must be checked and updated using PostgreSQL `SELECT ... FOR UPDATE`. In-memory locks or application mutexes must never replace database row locks.
- **Nesting:** Reuses existing transactions when passed `existingTx`.

### 7. Financial Precision & Arithmetic (`src/shared/precision/money.ts`)

- Monetary amounts: `NUMERIC(18,2)`
- Fuel quantities: `NUMERIC(12,3)`
- **Rule:** Never use JavaScript Number (IEEE 754 float) for financial math.
- For addition and subtraction (ledger summation), amounts are scaled to integer cents/piastres using native `BigInt` without floating-point representation hazards (`"0.10"` + `"0.20"` = `"0.30"`).
- For multiplication and division (fuel purchase pricing in Phase 5), a dedicated arbitrary-precision library (`decimal.js` or `bignumber.js`) is recommended to enforce explicit rounding policies (such as Banker's rounding / `ROUND_HALF_EVEN`).

---

## Session-Based Authentication & Authorization (Phase 4)

### 1. Server-Side Session Architecture

The platform deliberately uses **server-side sessions stored in PostgreSQL**, not JWTs or stateless tokens:
- **Session Store:** `connect-pg-simple` backed by the `auth_sessions` table in PostgreSQL.
- **Shared Connection Pool:** Reuses the existing application PostgreSQL pool in `src/db/client.ts`. No redundant connection pools are created.
- **Session Cookie:**
  - Name: `wifuel.sid`
  - `httpOnly: true` (prevents JavaScript/XSS access)
  - `secure: true` in production (enforces HTTPS)
  - `sameSite: 'lax'` (CSRF defense for top-level navigation)
  - `path: '/'` (accessible across all API endpoints)
  - `maxAge: 7 days` (604,800,000 ms)
- **Session Lifecycle:**
  - `saveUninitialized: false` (prevents empty session allocation)
  - `resave: false` (avoids unnecessary database writes)
  - `pruneSessionInterval: 900` (automatically cleans expired sessions every 15 minutes)
  - **Session Fixation Prevention:** Session ID is explicitly regenerated (`req.session.regenerate`) upon every successful login.
  - **All-Device Logout:** Revokes all active sessions for a user by deleting rows in `auth_sessions` matching `sess->>'userId'`.

### 2. CSRF Protection (Synchronizer Token Pattern)

To safeguard session cookies against Cross-Site Request Forgery:
- **Token Generation:** 32-byte cryptographically secure random tokens (`crypto.randomBytes(32).toString('hex')`).
- **Token Fetching:** Client retrieves the CSRF token via `GET /api/v1/auth/csrf` (or during login) and includes it in mutating requests via the `X-CSRF-Token` header.
- **Safe Methods:** `GET`, `HEAD`, and `OPTIONS` bypass validation.
- **Unsafe Methods:** `POST`, `PUT`, `PATCH`, `DELETE` require a valid `X-CSRF-Token` header that matches `req.session.csrfToken` using timing-safe comparison (`crypto.timingSafeEqual`).
- **Origin / Referer Validation:** Mutating requests must have an `Origin` or `Referer` matching the configured `CORS_ORIGIN`.

### 3. Authorization Model (Separation of Concerns)

The database strictly separates platform roles from station memberships:

1. **System Role (`users.system_role`):**
   - `USER`: Regular end-user / driver.
   - `ADMIN`: Platform administrator with universal read/write access.
2. **Station Member Role (`station_members.role`):**
   - `OWNER`: Station owner with administrative rights within their station.
   - `ATTENDANT`: Station attendant with operational dispensing rights within their station.

**Authorization Rules:**
- Drivers are regular `USER`s. There are no system roles named `DRIVER` or `STATION_STAFF`.
- Public registration (`POST /api/v1/auth/register`) strictly sets `system_role = 'USER'`. Input attempting to set `systemRole` is rejected.
- A user can belong to multiple stations with different roles.
- Station authorization checks (`requireStationRole`) inspect `station_members` for the specific station and target role.
- Platform `ADMIN` automatically satisfies any station role check.

### 4. Authentication Endpoints

All endpoints are versioned under `/api/v1`:

| Method | Endpoint | Protection | Description |
|---|---|---|---|
| `GET` | `/api/v1/auth/csrf` | Public (Session) | Returns CSRF token (`{ data: { csrfToken } }`) |
| `POST` | `/api/v1/auth/register` | Public, CSRF | Creates new `USER` account (bcrypt cost 12, phone normalized). Returns `201 Created`. |
| `POST` | `/api/v1/auth/login` | Public, CSRF, Rate-Limited (20 req / 15m) | Authenticates credentials, regenerates session, rotates CSRF token. Returns user profile + `csrfToken`. |
| `POST` | `/api/v1/auth/logout` | Authenticated, CSRF | Destroys current session and clears `wifuel.sid` cookie. |
| `POST` | `/api/v1/auth/logout-all` | Authenticated, CSRF | Revokes all active sessions for the user across all devices. |
| `GET` | `/api/v1/users/me` | Authenticated | Returns authenticated user profile, system role, and active station memberships. |

### 5. CLI Administrator Provisioning

To securely provision the initial platform administrator without direct database tampering:

```bash
npx tsx src/scripts/create-admin.ts "<fullName>" "<phone>" "<password>"
```

- Normalizes phone number format.
- Hashes password using bcrypt with work factor 12.
- Sets `system_role = 'ADMIN'` and `status = 'ACTIVE'`.
- Safe against accidental overwrites if the phone number already exists.

---

## Financial Core & Operations (Phases 5 to 9)

### 1. Account Types & Normal Balances

Only four financial account types exist, with strictly enforced normal-balance directions:
- `PLATFORM_CASH`: Debit - Credit (Platform-wide central account)
- `USER_AVAILABLE`: Credit - Debit (One per user)
- `USER_ALLOCATED`: Credit - Debit (One per user/station pair)
- `STATION_PAYABLE`: Credit - Debit (One per station)

Available Balance formula:
$$\text{Available Balance} = \text{Ledger Balance} - \text{Active Holds}$$
where $\text{Outstanding Hold} = \text{hold\_amount} - \text{captured\_amount} - \text{released\_amount}$.

### 2. Financial Endpoints Matrix

All endpoints are versioned under `/api/v1` and require session authentication unless public:

| Domain | Method | Endpoint | Protection | Description |
|---|---|---|---|---|
| **Wallet** | `GET` | `/api/v1/wallet` | User | Summary of available, allocated balances and holds (SDG) |
| | `GET` | `/api/v1/wallet/transactions` | User | Paginated user transaction history |
| | `POST` | `/api/v1/wallet/top-ups` | User, Idempotency | Create PENDING top-up request with bank reference |
| | `GET` | `/api/v1/wallet/top-ups` | User | List user's top-up requests |
| | `POST` | `/api/v1/wallet/allocations` | User, Idempotency | Allocate available balance to station |
| | `POST` | `/api/v1/wallet/deallocations` | User, Idempotency | Deallocate station balance back to available |
| | `POST` | `/api/v1/wallet/transfers` | User, Idempotency | Transfer allocated balance between stations |
| | `POST` | `/api/v1/wallet/withdrawals` | User, Idempotency | Request withdrawal to personal bank account |
| | `GET` | `/api/v1/wallet/withdrawals` | User | List user's withdrawal requests |
| **Admin Top-Up** | `GET` | `/api/v1/admin/top-ups` | Admin | Review pending top-up verification queue |
| | `POST` | `/api/v1/admin/top-ups/:id/approve` | Admin | Confirm bank transfer arrival & credit wallet |
| | `POST` | `/api/v1/admin/top-ups/:id/reject` | Admin | Reject unverified top-up request |
| **Fuel Purchase** | `POST` | `/api/v1/fuel-purchases` | User, Idempotency | Request fuel purchase with 10-min hold |
| | `GET` | `/api/v1/fuel-purchases` | User | List user's fuel purchases |
| | `GET` | `/api/v1/fuel-purchases/:id` | Authenticated | Fuel purchase detail & events |
| | `POST` | `/api/v1/fuel-purchases/:id/start` | Attendant / Owner | Lock quote snapshot and start dispensing |
| | `POST` | `/api/v1/fuel-purchases/:id/complete` | Attendant / Owner | Complete dispensing, capture actual amount, release remainder |
| | `POST` | `/api/v1/fuel-purchases/:id/cancel` | User | Cancel unstarted purchase & release hold |
| | `POST` | `/api/v1/fuel-purchases/:id/mark-unknown` | Attendant / Admin | Mark unknown outcome, retain hold |
| | `POST` | `/api/v1/fuel-purchases/expire-unstarted` | Admin | Batch expire unstarted expired holds |
| **Withdrawals** | `GET` | `/api/v1/admin/withdrawals` | Admin | List pending withdrawal requests |
| | `POST` | `/api/v1/admin/withdrawals/:id/approve` | Admin | Reserve central cash commitment & start transfer |
| | `POST` | `/api/v1/admin/withdrawals/:id/reject` | Admin | Reject withdrawal & release hold |
| | `POST` | `/api/v1/admin/withdrawals/:id/confirm-success` | Admin | Confirm transfer success with bank reference |
| | `POST` | `/api/v1/admin/withdrawals/:id/confirm-failure` | Admin | Confirm transfer failed & release hold |
| | `POST` | `/api/v1/admin/withdrawals/:id/mark-unknown` | Admin | Mark outcome unknown & retain commitment |
| **Settlements** | `GET` | `/api/v1/admin/settlements/eligible` | Admin | List stations exceeding minimum settlement threshold |
| | `GET` | `/api/v1/admin/settlements` | Admin | List station settlement queue |
| | `POST` | `/api/v1/admin/settlements` | Admin, Idempotency | Create settlement request with hold on STATION_PAYABLE |
| | `POST` | `/api/v1/admin/settlements/:id/start` | Admin | Check central cash & begin processing |
| | `POST` | `/api/v1/admin/settlements/:id/confirm-success` | Admin | Confirm bank transfer success with reference |
| | `POST` | `/api/v1/admin/settlements/:id/confirm-failure` | Admin | Confirm bank transfer failed & release hold |
| | `POST` | `/api/v1/admin/settlements/:id/mark-unknown` | Admin | Mark outcome unknown & retain commitment |
| **Reversals** | `POST` | `/api/v1/admin/transactions/:id/reversal` | Admin, Idempotency | Execute full reversal of completed transaction |
| | `GET` | `/api/v1/admin/reversals` | Admin | List historical reversal transactions |
| **Reconciliation** | `GET` | `/api/v1/admin/transactions/needs-review` | Admin | Queue of UNKNOWN or stuck transactions |
| | `GET` | `/api/v1/admin/transactions/:id/events` | Admin | Complete immutable audit event trail |

### 3. Bootstrap Finance CLI

```bash
npm run db:bootstrap-finance
```
Idempotently creates the platform central cash account (`PLATFORM_CASH`) and verifies ownership constraints.

---

## Code Organization

```
src/
├── app.ts                  # Express application setup & middleware pipeline
├── index.ts                # HTTP server startup & graceful shutdown
├── config/
│   └── env.ts              # Zod-validated environment configuration (inc. SESSION_SECRET)
├── db/
│   ├── client.ts           # Centralized pg Pool & Drizzle client
│   ├── transaction.ts      # Atomic transaction helper & row locking conventions
│   ├── schema.ts           # Root database schema exports
│   └── schema/             # Core table definitions & relationships (11 tables)
├── middleware/
│   ├── authenticate.ts     # Session authentication & active user verification
│   ├── authorize.ts        # System role & station membership authorization
│   ├── csrf.ts             # Synchronizer CSRF protection & origin validation
│   ├── rate-limit.ts       # Rate limiting for sensitive endpoints (auth)
│   ├── session.ts          # Express session configuration with connect-pg-simple
│   ├── request-id.ts       # X-Request-ID correlation tracking
│   ├── validate-request.ts # Reusable Zod validation middleware
│   ├── not-found.ts        # 404 handler
│   └── error-handler.ts    # Centralized safe error responder
├── modules/
│   ├── auth/               # Authentication controllers, routes, schemas & services
│   ├── bank-accounts/      # User bank account management
│   ├── financial-core/     # Reusable financial services (accounts, balance, holds, ledger, idempotency, events)
│   ├── fuel-purchases/     # Fuel purchase lifecycle (quote, hold, start, complete, cancel)
│   ├── health/             # Liveness (/health) & readiness (/ready) checks
│   ├── reconciliation/     # Admin audit & unknown transaction review queues
│   ├── reversals/          # Full reversal engine with double-entry opposite postings
│   ├── settlements/        # Station settlement lifecycle & eligibility checks
│   ├── stations/           # Stations, memberships, fuel prices & station bank accounts
│   ├── users/              # User profile routes & controllers
│   └── wallet/             # Driver wallet summary, top-ups, allocations & transfers
├── scripts/
│   ├── bootstrap-finance.ts# CLI platform cash provisioning
│   └── create-admin.ts     # CLI administrator account provisioning script
└── shared/
    ├── errors/             # AppError classes & PostgreSQL error mapper
    ├── logging/            # Structured logger with sensitive data redaction
    ├── precision/          # Lossless decimal string math & fuel price multiplication
    ├── http/               # Standardized JSON response envelope helpers
    └── types/              # Express request augmentation & shared types
```
├── modules/
│   ├── auth/               # Authentication controllers, routes, schemas & services
│   ├── health/             # Liveness (/health) & readiness (/ready) checks
│   └── users/              # User profile routes & controllers
├── scripts/
│   └── create-admin.ts     # CLI administrator account provisioning script
└── shared/
    ├── errors/             # AppError classes & PostgreSQL error mapper
    ├── logging/            # Structured logger with sensitive data redaction
    ├── precision/          # Lossless decimal string math & format validators
    ├── http/               # Standardized JSON response envelope helpers
    └── types/              # Express request augmentation & shared types
```

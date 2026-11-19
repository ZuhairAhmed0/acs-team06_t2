import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express, { type Express } from "express";
import type { Store } from "express-session";
import helmet from "helmet";
import morgan from "morgan";

import { env } from "./config/env.js";
import { csrfProtection } from "./middleware/csrf.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { createSessionMiddleware } from "./middleware/session.js";
import { createAuthRouter } from "./modules/auth/auth.routes.js";
import type { DatabaseReadinessCheck } from "./modules/health/health.controller.js";
import { bankAccountsRouter } from "./modules/bank-accounts/bank-accounts.routes.js";
import { fuelPurchasesRouter } from "./modules/fuel-purchases/fuel-purchases.routes.js";
import { createHealthRouter } from "./modules/health/health.routes.js";
import { adminReconciliationRouter } from "./modules/reconciliation/reconciliation.routes.js";
import { adminReversalsRouter } from "./modules/reversals/reversals.routes.js";
import { adminSettlementsRouter } from "./modules/settlements/settlements.routes.js";
import { stationsRouter } from "./modules/stations/stations.routes.js";
import { createUsersRouter } from "./modules/users/users.routes.js";
import { adminTopUpsRouter, walletRouter } from "./modules/wallet/wallet.routes.js";
import { frontendCompatRouter } from "./modules/frontend-compat/frontend-compat.routes.js";
import {
  adminWithdrawalsRouter,
  walletWithdrawalsRouter,
} from "./modules/withdrawals/withdrawals.routes.js";

export interface AppDependencies {
  databaseReadinessCheck?: DatabaseReadinessCheck;
  registerAdditionalRoutes?: (app: Express) => void;
  sessionStore?: Store;
  disableCsrfForTesting?: boolean;
}

morgan.token("request-id", (request, response) => {
  const resWithLocals = response as unknown as { locals?: { requestId?: string } };
  const reqWithId = request as unknown as { id?: string };
  return resWithLocals.locals?.requestId ?? reqWithId.id ?? "-";
});

morgan.token("path", (request) =>
  new URL(request.url ?? "/", "http://localhost").pathname,
);

const requestLogger = morgan(
  "[:request-id] :method :path :status :res[content-length] - :response-time ms",
);

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();

  app.disable("x-powered-by");

  // 1. Correlation tracking: attaches X-Request-ID before any other middleware
  app.use(requestIdMiddleware);

  // 2. Security headers
  app.use(helmet({ contentSecurityPolicy: false }));

  // 3. CORS: restrictive, non-wildcard configuration with credentials & CSRF header allowed
  if (env.CORS_ORIGIN) {
    app.use(
      cors({
        origin: env.CORS_ORIGIN,
        credentials: true,
        allowedHeaders: ["Content-Type", "X-CSRF-Token", "X-Request-ID", "Idempotency-Key"],
      }),
    );
  }

  // 4. Body parser with strict payload size limit
  app.use(express.json({ limit: "100kb" }));

  // 5. Safe request completion logging with correlation ID
  app.use(requestLogger);

  // 6. Server-side session management (PostgreSQL-backed store)
  app.use(createSessionMiddleware({ store: dependencies.sessionStore }));

  // 7. CSRF Synchronizer Token Protection
  if (!dependencies.disableCsrfForTesting) {
    app.use(csrfProtection);
  }

  // 8. Base API v1 Routes
  app.use(
    "/api/v1",
    createHealthRouter(dependencies.databaseReadinessCheck),
  );
  app.use("/api/v1/auth", createAuthRouter());
  app.use("/api/v1/users", createUsersRouter());
  app.use("/api/v1/wallet", walletRouter);
  app.use("/api/v1/admin/top-ups", adminTopUpsRouter);
  app.use("/api/v1/stations", stationsRouter);
  app.use("/api/v1/bank-accounts", bankAccountsRouter);
  app.use("/api/v1/fuel-purchases", fuelPurchasesRouter);
  app.use("/api/v1/wallet/withdrawals", walletWithdrawalsRouter);
  app.use("/api/v1/admin/withdrawals", adminWithdrawalsRouter);
  app.use("/api/v1/admin/settlements", adminSettlementsRouter);
  app.use("/api/v1/admin/transactions", adminReconciliationRouter);
  app.use("/api/v1/admin/reversals", adminReversalsRouter);
  app.use("/api/v1", frontendCompatRouter);

  // 9. Test / module route extension hook
  dependencies.registerAdditionalRoutes?.(app);

  // 10. Serve frontend build in production if present
  const frontDistPath = path.resolve(process.cwd(), "front/dist");
  if (fs.existsSync(frontDistPath)) {
    app.use(express.static(frontDistPath));
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path.startsWith("/api")) {
        return next();
      }
      response.sendFile(path.join(frontDistPath, "index.html"));
    });
  }

  // 11. Error handling pipeline
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app: Express = createApp();

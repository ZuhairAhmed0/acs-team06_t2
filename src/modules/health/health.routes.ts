import { Router } from "express";

import { checkDatabaseReadiness } from "../../db/client.js";
import {
  createReadinessHandler,
  getHealth,
  type DatabaseReadinessCheck,
} from "./health.controller.js";

export function createHealthRouter(
  readinessCheck: DatabaseReadinessCheck = checkDatabaseReadiness,
): Router {
  const router = Router();

  router.get("/health", getHealth);
  router.get("/ready", createReadinessHandler(readinessCheck));

  return router;
}

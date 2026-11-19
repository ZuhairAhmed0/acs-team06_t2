import type { RequestHandler } from "express";

import { ServiceUnavailableError } from "../../shared/errors/app-error.js";

export type DatabaseReadinessCheck = () => Promise<void>;

export const getHealth: RequestHandler = (_request, response) => {
  response.status(200).json({
    data: {
      status: "ok",
      service: "where-is-fuel-api",
    },
  });
};

export function createReadinessHandler(
  checkDatabaseReadiness: DatabaseReadinessCheck,
): RequestHandler {
  return async (_request, response, next) => {
    try {
      await checkDatabaseReadiness();

      response.status(200).json({
        data: {
          status: "ready",
          service: "where-is-fuel-api",
        },
      });
    } catch {
      next(new ServiceUnavailableError("Service is not ready."));
    }
  };
}

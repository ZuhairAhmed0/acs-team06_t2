import type { Response } from "express";

export interface ApiSuccessResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

/**
 * Sends a consistent structured success response.
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: Record<string, unknown>,
): Response {
  const body: ApiSuccessResponse<T> = { data };
  if (meta) {
    body.meta = meta;
  }
  return res.status(statusCode).json(body);
}

/**
 * Sends a consistent structured error response.
 */
export function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
): Response {
  const body: ApiErrorResponse = {
    error: {
      code,
      message,
      requestId,
    },
  };
  return res.status(statusCode).json(body);
}

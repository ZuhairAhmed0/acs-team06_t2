import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

/**
 * Valid correlation ID pattern:
 * Allows standard RFC 4122 UUIDs or safe alphanumeric identifiers (8-64 chars).
 * Rejects control characters, spaces, HTML, SQL injections, or overly long strings.
 */
const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{8,64}$/;

export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const incomingHeader = req.headers["x-request-id"];
  let requestId: string;

  if (
    typeof incomingHeader === "string" &&
    SAFE_REQUEST_ID_REGEX.test(incomingHeader.trim())
  ) {
    requestId = incomingHeader.trim();
  } else {
    requestId = randomUUID();
  }

  // Attach to Express request and response locals for downstream middleware and controllers
  req.id = requestId;
  res.locals.requestId = requestId;

  // Set standard correlation response header
  res.setHeader("X-Request-ID", requestId);

  next();
};

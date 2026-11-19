import { ErrorCode } from "./error-codes.js";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  public constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends AppError {
  public constructor(message = "Bad request.") {
    super(400, ErrorCode.BAD_REQUEST, message);
  }
}

export class ValidationError extends AppError {
  public constructor(message = "Invalid request parameters.") {
    super(400, ErrorCode.VALIDATION_ERROR, message);
  }
}

export class UnauthorizedError extends AppError {
  public constructor(message = "Authentication required.") {
    super(401, ErrorCode.UNAUTHORIZED, message);
  }
}

export class ForbiddenError extends AppError {
  public constructor(message = "Access denied.") {
    super(403, ErrorCode.FORBIDDEN, message);
  }
}

export class NotFoundError extends AppError {
  public constructor(message = "Resource not found.") {
    super(404, ErrorCode.NOT_FOUND, message);
  }
}

export class ConflictError extends AppError {
  public constructor(message = "Resource conflict.") {
    super(409, ErrorCode.CONFLICT, message);
  }
}

export class UnprocessableContentError extends AppError {
  public constructor(message = "Unprocessable content.") {
    super(422, ErrorCode.UNPROCESSABLE_CONTENT, message);
  }
}

export class TooManyRequestsError extends AppError {
  public constructor(message = "Too many requests. Please slow down.") {
    super(429, ErrorCode.TOO_MANY_REQUESTS, message);
  }
}

export class InternalServerError extends AppError {
  public constructor(message = "An unexpected error occurred.") {
    super(500, ErrorCode.INTERNAL_SERVER_ERROR, message);
  }
}

export class ServiceUnavailableError extends AppError {
  public constructor(message = "Service is not ready.") {
    super(503, ErrorCode.SERVICE_UNAVAILABLE, message);
  }
}

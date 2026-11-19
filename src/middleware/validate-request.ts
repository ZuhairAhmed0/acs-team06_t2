import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { z, ZodTypeAny } from "zod";

import { ValidationError } from "../shared/errors/app-error.js";

export interface RequestValidationSchemas<
  TBody extends ZodTypeAny = ZodTypeAny,
  TParams extends ZodTypeAny = ZodTypeAny,
  TQuery extends ZodTypeAny = ZodTypeAny,
> {
  body?: TBody;
  params?: TParams;
  query?: TQuery;
}

export interface ValidatedRequestData<
  TBody = unknown,
  TParams = unknown,
  TQuery = unknown,
> {
  body: TBody;
  params: TParams;
  query: TQuery;
}

function formatValidationIssues(
  location: "body" | "params" | "query",
  error: z.ZodError,
): string {
  const formatted = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : location;
    return `${location}.${path}: ${issue.message}`;
  });

  return `Validation failed: ${formatted.join("; ")}`;
}

/**
 * Reusable request validation middleware powered by Zod.
 * Validates request body, route parameters, and query strings.
 *
 * Guarantees:
 * 1. Invalid input is rejected before controllers execute (via ValidationError -> errorHandler).
 * 2. Parsed & coerced data is attached to `res.locals.validated`.
 * 3. Never leaks stack traces or system internals.
 * 4. Strongly typed using TypeScript generics without unsafe `any`.
 */
export function validateRequest<
  TBody extends ZodTypeAny = ZodTypeAny,
  TParams extends ZodTypeAny = ZodTypeAny,
  TQuery extends ZodTypeAny = ZodTypeAny,
>(
  schemas: RequestValidationSchemas<TBody, TParams, TQuery>,
): RequestHandler {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const validated: ValidatedRequestData<
        z.infer<TBody>,
        z.infer<TParams>,
        z.infer<TQuery>
      > = {
        body: undefined as z.infer<TBody>,
        params: undefined as z.infer<TParams>,
        query: undefined as z.infer<TQuery>,
      };

      if (schemas.params) {
        const result = await schemas.params.safeParseAsync(req.params);
        if (!result.success) {
          next(new ValidationError(formatValidationIssues("params", result.error)));
          return;
        }
        validated.params = result.data;
      }

      if (schemas.query) {
        const result = await schemas.query.safeParseAsync(req.query);
        if (!result.success) {
          next(new ValidationError(formatValidationIssues("query", result.error)));
          return;
        }
        validated.query = result.data;
      }

      if (schemas.body) {
        const result = await schemas.body.safeParseAsync(req.body);
        if (!result.success) {
          next(new ValidationError(formatValidationIssues("body", result.error)));
          return;
        }
        validated.body = result.data;
        try {
          req.body = result.data;
        } catch {
          // ignore if req.body has a non-writable descriptor in specific testing mocks
        }
      }

      res.locals.validated = validated;
      next();
    } catch (unexpectedError) {
      next(unexpectedError);
    }
  };
}

/**
 * Strongly-typed accessor for validated request data stored in res.locals.
 */
export function getValidatedData<
  TBody = unknown,
  TParams = unknown,
  TQuery = unknown,
>(res: Response): ValidatedRequestData<TBody, TParams, TQuery> {
  return res.locals.validated as ValidatedRequestData<TBody, TParams, TQuery>;
}

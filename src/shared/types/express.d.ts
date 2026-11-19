import "express";
import "express-session";

import type { AuthenticatedUser } from "../../modules/auth/auth.types.js";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      id?: string;
      user?: AuthenticatedUser;
    }
    interface Locals {
      requestId?: string;
      validated?: {
        body?: unknown;
        params?: unknown;
        query?: unknown;
      };
    }
  }
}

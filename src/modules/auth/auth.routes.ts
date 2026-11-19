import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.js";
import { authRateLimiter } from "../../middleware/rate-limit.js";
import { validateRequest } from "../../middleware/validate-request.js";
import {
  getCsrfToken,
  login,
  logout,
  logoutAll,
  register,
} from "./auth.controller.js";
import { loginSchema, registerSchema } from "./auth.schemas.js";

export function createAuthRouter(): Router {
  const router = Router();

  // 1. CSRF token bootstrap (initializes anonymous session if absent)
  router.get("/csrf", getCsrfToken);

  // 2. Public User Registration
  router.post(
    "/register",
    authRateLimiter,
    validateRequest({ body: registerSchema }),
    register,
  );

  // 3. User Login
  router.post(
    "/login",
    authRateLimiter,
    validateRequest({ body: loginSchema }),
    login,
  );

  // 4. Logout (destroys current session)
  router.post("/logout", authenticate, logout);

  // 5. Logout All (revokes all active sessions for current user)
  router.post("/logout-all", authenticate, logoutAll);

  return router;
}

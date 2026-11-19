import { Router } from "express";

import { authenticate } from "../../middleware/authenticate.js";
import { getMe } from "../auth/auth.controller.js";

export function createUsersRouter(): Router {
  const router = Router();

  // Returns safe details of currently authenticated user
  router.get("/me", authenticate, getMe);

  return router;
}

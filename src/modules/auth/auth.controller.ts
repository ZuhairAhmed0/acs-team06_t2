import type { NextFunction, Request, RequestHandler, Response } from "express";

import { generateCsrfToken } from "../../middleware/csrf.js";
import { SESSION_COOKIE_NAME } from "../../middleware/session.js";
import { getValidatedData } from "../../middleware/validate-request.js";
import type { LoginInput, RegisterInput } from "./auth.schemas.js";
import { authService } from "./auth.service.js";

export const getCsrfToken: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    if (!req.session.csrfToken) {
      req.session.csrfToken = generateCsrfToken();
    }

    req.session.save((err) => {
      if (err) {
        next(err);
        return;
      }
      res.status(200).json({
        data: {
          csrfToken: req.session.csrfToken,
        },
      });
    });
  } catch (error) {
    next(error);
  }
};

export const register: RequestHandler = async (
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { body } = getValidatedData<RegisterInput>(res);
    const newUser = await authService.registerUser(body);

    res.status(201).json({
      data: newUser,
    });
  } catch (error) {
    next(error);
  }
};

export const login: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { body } = getValidatedData<LoginInput>(res);
    const user = await authService.verifyCredentials(body.phone, body.password);

    // Regenerate session ID to prevent Session Fixation attacks
    req.session.regenerate((err) => {
      if (err) {
        next(err);
        return;
      }

      req.session.userId = user.id;
      const newCsrfToken = generateCsrfToken();
      req.session.csrfToken = newCsrfToken;

      // Ensure session is persisted to PostgreSQL before sending response
      req.session.save((saveErr) => {
        if (saveErr) {
          next(saveErr);
          return;
        }

        res.status(200).json({
          data: {
            user: {
              id: user.id,
              fullName: user.fullName,
              phone: user.phone,
              systemRole: user.systemRole,
              status: user.status,
            },
            csrfToken: newCsrfToken,
          },
        });
      });
    });
  } catch (error) {
    next(error);
  }
};

export const logout: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        next(err);
        return;
      }
      res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      res.status(200).json({
        data: {
          message: "Logged out successfully.",
        },
      });
    });
  } else {
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    res.status(200).json({
      data: {
        message: "Logged out successfully.",
      },
    });
  }
};

export const logoutAll: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user!.id;
    await authService.revokeAllUserSessions(userId);

    if (req.session) {
      req.session.destroy(() => {});
    }

    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    res.status(200).json({
      data: {
        message: "All sessions terminated successfully.",
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getMe: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    let memberships: any[] = [];
    try {
      memberships = await authService.getUserMemberships(req.user!.id);
    } catch {
      memberships = [];
    }

    res.status(200).json({
      data: {
        id: req.user!.id,
        fullName: req.user!.fullName,
        full_name: req.user!.fullName,
        phone: req.user!.phone,
        systemRole: req.user!.systemRole,
        system_role: req.user!.systemRole,
        role: req.user!.systemRole,
        status: req.user!.status,
        stationMemberships: memberships,
        station_memberships: memberships,
      },
    });
  } catch (error) {
    next(error);
  }
};

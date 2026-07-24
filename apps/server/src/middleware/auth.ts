import type { RequestHandler } from "express";
import { unauthenticated } from "../errors.js";
import { getUserFromRequest } from "../lib/session.js";

/**
 * Require a valid session. On success, req.user is guaranteed to be set.
 * Ownership checks for workspace-scoped resources build on top of this in
 * their own shared middleware (added in a later step) — never inline.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) throw unauthenticated();
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

import type { Request, RequestHandler } from "express";

interface RateLimitOptions {
  scope: string;
  maxAttempts: number;
  windowMs: number;
}

interface AttemptWindow {
  count: number;
  resetAt: number;
}

function normalizedUsername(req: Request): string {
  const value = req.body?.username;
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function createAuthRateLimiter({
  scope,
  maxAttempts,
  windowMs,
}: RateLimitOptions): { middleware: RequestHandler; resetAccount: (req: Request) => void } {
  const attempts = new Map<string, AttemptWindow>();

  function keysFor(req: Request): string[] {
    const keys = [`${scope}:ip:${req.ip || "unknown"}`];
    const username = normalizedUsername(req);
    if (username) keys.push(`${scope}:account:${username}`);
    return keys;
  }

  function getWindow(key: string, now: number): AttemptWindow {
    const existing = attempts.get(key);
    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 0, resetAt: now + windowMs };
      attempts.set(key, fresh);
      return fresh;
    }
    return existing;
  }

  function resetAccount(req: Request) {
    const username = normalizedUsername(req);
    if (username) attempts.delete(`${scope}:account:${username}`);
  }

  const middleware: RequestHandler = (req, res, next) => {
    const now = Date.now();
    const windows = keysFor(req).map((key) => getWindow(key, now));
    const blocked = windows.find((window) => window.count >= maxAttempts);

    if (blocked) {
      const retryAfterSeconds = Math.max(1, Math.ceil((blocked.resetAt - now) / 1000));
      res.set("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        message: "Too many attempts. Please wait a few minutes and try again.",
      });
      return;
    }

    for (const window of windows) window.count += 1;
    next();
  };

  return { middleware, resetAccount };
}
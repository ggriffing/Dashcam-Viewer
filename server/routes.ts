import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { authCredentialsSchema, signUpSchema, type User } from "@shared/schema";
import { verifyPassword } from "./password";
import { createAuthRateLimiter } from "./authRateLimit";
import { getAuth } from "@clerk/express";
import { z } from "zod";

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
      clerkUserId?: string;
    }
  }
}

function sendValidationError(res: Response, error: { issues: { message: string }[] }) {
  res.status(400).json({ message: error.issues[0]?.message || "Please check your entries." });
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const clerkAuth = getAuth(req);
  if (clerkAuth.userId) {
    req.clerkUserId = clerkAuth.userId;
    next();
    return;
  }

  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ message: "Sign in to continue." });
    return;
  }

  storage.getUser(userId).then((user) => {
    if (!user) {
      req.session.destroy(() => undefined);
      res.status(401).json({ message: "Your session has expired. Sign in again." });
      return;
    }
    req.user = user;
    next();
  }).catch(next);
}

function establishSession(req: Request, userId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      req.session.userId = userId;
      req.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
    });
  });
}

const signInRateLimit = createAuthRateLimiter({
  scope: "signin",
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
});

const signUpRateLimit = createAuthRateLimiter({
  scope: "signup",
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
});

const teslaDecryptionRequestSchema = z.object({
  // This is a short-lived Dashcam Viewer bearer authorization, not a Tesla
  // password. It is used for this request only and is never persisted.
  authorization: z.string().trim().min(20).max(10_000),
  items: z.array(z.object({
    id: z.string().uuid(),
    vin: z.string().length(17),
    key_id: z.number().int().positive(),
    timestamp: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    wrapped_key: z.string().min(1).max(256),
    public_key: z.string().min(1).max(256),
  })).min(1).max(20),
});

interface TeslaDecryptionWindow {
  count: number;
  resetAt: number;
}

const teslaDecryptionAttempts = new Map<string, TeslaDecryptionWindow>();
const TESLA_DECRYPTION_WINDOW_MS = 15 * 60 * 1000;
const TESLA_DECRYPTION_MAX_ATTEMPTS = 12;

const teslaDecryptionRateLimit: RequestHandler = (req, res, next) => {
  const now = Date.now();
  const keys = [`tesla-decryption:ip:${req.ip || "unknown"}`];
  const userId = req.clerkUserId ?? req.user?.id;
  if (userId) keys.push(`tesla-decryption:user:${userId}`);

  const windows = keys.map((key) => {
    const existing = teslaDecryptionAttempts.get(key);
    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 0, resetAt: now + TESLA_DECRYPTION_WINDOW_MS };
      teslaDecryptionAttempts.set(key, fresh);
      return fresh;
    }
    return existing;
  });
  const blocked = windows.find((window) => window.count >= TESLA_DECRYPTION_MAX_ATTEMPTS);
  if (blocked) {
    res.set("Retry-After", String(Math.max(1, Math.ceil((blocked.resetAt - now) / 1000))));
    res.status(429).json({ message: "Too many Tesla decryption requests. Please wait a few minutes and try again." });
    return;
  }

  for (const window of windows) window.count += 1;
  next();
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/auth/me", requireAuth, (req, res) => {
    if (req.clerkUserId) {
      res.json({ user: { id: req.clerkUserId, username: "Clerk user" } });
      return;
    }
    res.json({ user: req.user });
  });

  app.post("/api/auth/signup", signUpRateLimit.middleware, async (req, res, next) => {
    const parsed = signUpSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    try {
      const user = await storage.createUser(parsed.data);
      await establishSession(req, user.id);
      res.status(201).json({ user });
    } catch (error: any) {
      if (error?.code === "23505") {
        res.status(409).json({ message: "That username is already in use." });
        return;
      }
      next(error);
    }
  });

  app.post("/api/auth/signin", signInRateLimit.middleware, async (req, res, next) => {
    const parsed = authCredentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    try {
      const user = await storage.getUserCredentials(parsed.data.username);
      const valid = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false;
      if (!user || !valid) {
        res.status(401).json({ message: "Invalid username or password." });
        return;
      }

      await establishSession(req, user.id);
      signInRateLimit.resetAccount(req);
      res.json({ user: { id: user.id, username: user.username } });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/signout", (req, res, next) => {
    req.session.destroy((error) => {
      if (error) {
        next(error);
        return;
      }
      res.clearCookie("connect.sid");
      res.status(204).end();
    });
  });

  // Lightweight capability check — tells the client whether the server has a
  // Maps API key configured, so the UI can show or hide the map overlay option.
  app.get("/api/map-available", requireAuth, (_req, res) => {
    const hasKey = !!(process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_API_KEY);
    res.json({ available: hasKey });
  });

  /**
   * Requests clip keys from Tesla without receiving or storing video bytes.
   * This is intentionally a no-store, authenticated pass-through: the browser
   * does all AES decryption and only clip ownership metadata reaches Tesla.
   */
  app.post("/api/tesla/decryption-keys", requireAuth, teslaDecryptionRateLimit, async (req, res, next) => {
    const parsed = teslaDecryptionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Provide a valid current Tesla Dashcam Viewer authorization and clip metadata." });
      return;
    }

    const authorization = parsed.data.authorization.replace(/^Bearer\s+/i, "");
    try {
      const upstream = await fetch("https://dashcam.tesla.com/api/1/decrypt/batch", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authorization}`,
          "Content-Type": "application/json",
          Origin: "https://dashcam.tesla.com",
          Referer: "https://dashcam.tesla.com/",
        },
        body: JSON.stringify({ items: parsed.data.items }),
        signal: AbortSignal.timeout(15_000),
      });

      if (upstream.status === 401 || upstream.status === 403) {
        res.status(401).json({ message: "Tesla did not accept that authorization. Get a fresh one from Tesla Dashcam Viewer and try again." });
        return;
      }
      if (!upstream.ok) {
        res.status(502).json({ message: "Tesla's decryption service could not provide clip keys. Try again shortly." });
        return;
      }

      const upstreamPayload = await upstream.json() as { results?: unknown };
      if (!Array.isArray(upstreamPayload.results)) {
        res.status(502).json({ message: "Tesla returned an unexpected decryption response." });
        return;
      }

      const results = upstreamPayload.results
        .filter((item): item is { id: string; key?: string; error?: string } =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as { id?: unknown }).id === "string" &&
          (typeof (item as { key?: unknown }).key === "string" ||
            typeof (item as { error?: unknown }).error === "string"),
        )
        .map(({ id, key, error }) => ({ id, key, error }));

      res.set({
        "Cache-Control": "no-store, private",
        Pragma: "no-cache",
      });
      res.json({ results });
    } catch (error) {
      // Do not include network request details here: they can contain the
      // one-time authorization in diagnostic output.
      console.error("[tesla-decryption] Tesla key request failed");
      if (error instanceof DOMException && error.name === "TimeoutError") {
        res.status(504).json({ message: "Tesla's decryption service took too long to respond. Please try again." });
        return;
      }
      next(new Error("Could not reach Tesla's decryption service. Check your connection and try again."));
    }
  });

  // Proxy that fetches a Google Maps Static API image server-side so the
  // browser canvas stays origin-clean for WebCodecs VideoFrame creation.
  // Accepts structured map parameters (never a caller-supplied URL).
  app.get("/api/map-proxy", requireAuth, async (req, res) => {
    const apiKey =
      process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "Maps API key not configured on server" });
      return;
    }

    const { center, zoom, path, size } = req.query as Record<string, string | undefined>;

    if (!center || !zoom || !path || !size) {
      res.status(400).json({ error: "Missing required parameters: center, zoom, path, size" });
      return;
    }

    if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(center)) {
      res.status(400).json({ error: "Invalid center format" });
      return;
    }

    const zoomNum = parseInt(zoom, 10);
    if (Number.isNaN(zoomNum) || zoomNum < 1 || zoomNum > 20) {
      res.status(400).json({ error: "Invalid zoom value" });
      return;
    }

    if (typeof path !== "string" || path.length > 8192) {
      res.status(400).json({ error: "path parameter too long or missing" });
      return;
    }

    if (!/^\d+x\d+$/.test(size)) {
      res.status(400).json({ error: "Invalid size format" });
      return;
    }
    const [w, h] = size.split("x").map(Number);
    if (w < 1 || w > 640 || h < 1 || h > 640) {
      res.status(400).json({ error: "Size out of allowed range (max 640x640)" });
      return;
    }

    const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
    url.searchParams.set("center", center);
    url.searchParams.set("zoom", String(zoomNum));
    url.searchParams.set("size", size);
    url.searchParams.set("maptype", "roadmap");
    url.searchParams.set("path", path);
    url.searchParams.set("key", apiKey);

    try {
      const upstream = await fetch(url.toString());
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: "Maps API request failed" });
        return;
      }
      const contentType = upstream.headers.get("content-type") || "image/png";
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.set("Content-Type", contentType);
       res.set("Cache-Control", "private, max-age=3600");
      res.send(buffer);
    } catch (err) {
      console.error("[map-proxy] Fetch error:", err);
      res.status(500).json({ error: "Failed to fetch map image" });
    }
  });

  return httpServer;
}

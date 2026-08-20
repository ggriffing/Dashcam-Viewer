import type { Express, NextFunction, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { authCredentialsSchema, signUpSchema, type User } from "@shared/schema";
import { verifyPassword } from "./password";
import { createAuthRateLimiter } from "./authRateLimit";
import { getAuth } from "@clerk/express";

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

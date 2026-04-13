import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Map proxy — fetches a Google Maps Static API image server-side so the
  // browser can draw it on a WebCodecs-bound canvas without CORS tainting.
  app.get("/api/map-proxy", async (req, res) => {
    const rawUrl = req.query.url as string | undefined;
    if (!rawUrl) {
      res.status(400).json({ error: "Missing url parameter" });
      return;
    }
    // Only allow Google Maps Static API URLs to prevent open-proxy abuse.
    if (!rawUrl.startsWith("https://maps.googleapis.com/maps/api/staticmap")) {
      res.status(403).json({ error: "Only Google Maps Static API URLs are allowed" });
      return;
    }
    try {
      const upstream = await fetch(rawUrl);
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: "Maps API request failed" });
        return;
      }
      const contentType = upstream.headers.get("content-type") || "image/png";
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.set("Content-Type", contentType);
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Cache-Control", "public, max-age=3600");
      res.send(buffer);
    } catch (err) {
      console.error("[map-proxy] Fetch error:", err);
      res.status(500).json({ error: "Failed to fetch map image" });
    }
  });

  return httpServer;
}

import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Lightweight capability check — tells the client whether the server has a
  // Maps API key configured, so the UI can show or hide the map overlay option.
  app.get("/api/map-available", (_req, res) => {
    const hasKey = !!(process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_API_KEY);
    res.json({ available: hasKey });
  });

  // Proxy that fetches a Google Maps Static API image server-side so the
  // browser canvas stays origin-clean for WebCodecs VideoFrame creation.
  // Accepts structured map parameters (never a caller-supplied URL).
  app.get("/api/map-proxy", async (req, res) => {
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
      res.set("Cache-Control", "public, max-age=3600");
      res.send(buffer);
    } catch (err) {
      console.error("[map-proxy] Fetch error:", err);
      res.status(500).json({ error: "Failed to fetch map image" });
    }
  });

  return httpServer;
}

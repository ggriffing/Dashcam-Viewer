/**
 * Utilities for fetching and projecting a Google Maps Static API image
 * for use as a per-frame map overlay in the video export pipeline.
 *
 * The static map image is fetched once (via the /api/map-proxy backend
 * endpoint to avoid CORS issues) and then used for every frame.  Per-frame
 * work is limited to a cheap Mercator lat/lng → pixel projection so the
 * vehicle marker can be positioned correctly.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface StaticMapInfo {
  image: HTMLImageElement;
  centerLat: number;
  centerLng: number;
  zoom: number;
  pixelWidth: number;
  pixelHeight: number;
}

// Google Maps uses 256-pixel tiles at zoom 0.
const TILE_SIZE = 256;

// ---------------------------------------------------------------------------
// Mercator helpers
// ---------------------------------------------------------------------------

function lngToWorldFraction(lng: number): number {
  return (lng + 180) / 360;
}

function latToWorldFraction(lat: number): number {
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (1 - Math.log((1 + sinLat) / (1 - sinLat)) / (2 * Math.PI)) / 2;
  return Math.max(0, Math.min(1, y));
}

function latRadMercator(lat: number): number {
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const rad = Math.log((1 + sinLat) / (1 - sinLat)) / 2;
  return Math.max(Math.min(rad, Math.PI), -Math.PI) / 2;
}

/**
 * Calculate the maximum zoom level that still fits the bounding box inside
 * the given image dimensions (with a 1-level safety margin for padding).
 */
function calcBoundsZoom(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
  pxWidth: number,
  pxHeight: number,
): number {
  const latFraction = (latRadMercator(maxLat) - latRadMercator(minLat)) / Math.PI;
  const lngDiff = maxLng - minLng;
  const lngFraction = (lngDiff < 0 ? lngDiff + 360 : lngDiff) / 360;

  const latZoom =
    latFraction > 0
      ? Math.floor(Math.log(pxHeight / TILE_SIZE / latFraction) / Math.LN2)
      : 20;
  const lngZoom =
    lngFraction > 0
      ? Math.floor(Math.log(pxWidth / TILE_SIZE / lngFraction) / Math.LN2)
      : 20;

  // Subtract 1 so the route has breathing room around the edges.
  return Math.min(Math.max(latZoom, 1), Math.max(lngZoom, 1), 19) - 1;
}

/**
 * Downsample an array to at most maxPoints entries, keeping first and last.
 */
function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const result: T[] = [arr[0]];
  const step = (arr.length - 2) / (maxPoints - 2);
  for (let i = 1; i < maxPoints - 1; i++) {
    result.push(arr[Math.round(i * step)]);
  }
  result.push(arr[arr.length - 1]);
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a GPS coordinate into a pixel position within a static map image.
 *
 * Pass the SAME centerLat/centerLng/zoom that were used to request the image.
 * pixelWidth/pixelHeight are the dimensions of the fetched image.
 */
export function latLngToMapPixel(
  lat: number,
  lng: number,
  centerLat: number,
  centerLng: number,
  zoom: number,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number } {
  const scale = Math.pow(2, zoom) * TILE_SIZE;

  const centerX = lngToWorldFraction(centerLng) * scale;
  const centerY = latToWorldFraction(centerLat) * scale;

  const pointX = lngToWorldFraction(lng) * scale;
  const pointY = latToWorldFraction(lat) * scale;

  return {
    x: imageWidth / 2 + (pointX - centerX),
    y: imageHeight / 2 + (pointY - centerY),
  };
}

/**
 * Fetch a Google Maps Static API image via the /api/map-proxy backend
 * endpoint (which adds CORS headers so the image can be drawn on a
 * WebCodecs-bound canvas without tainting it).
 *
 * Returns null when the API key is missing, the path has no GPS points,
 * or the network request fails.
 */
export async function fetchStaticMapImage(
  path: LatLng[],
  apiKey: string,
  requestedWidth: number,
  requestedHeight: number,
): Promise<StaticMapInfo | null> {
  if (!apiKey) return null;

  const validPoints = path.filter((p) => p.lat !== 0 || p.lng !== 0);
  if (validPoints.length === 0) return null;

  // Bounding box
  const minLat = Math.min(...validPoints.map((p) => p.lat));
  const maxLat = Math.max(...validPoints.map((p) => p.lat));
  const minLng = Math.min(...validPoints.map((p) => p.lng));
  const maxLng = Math.max(...validPoints.map((p) => p.lng));

  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;
  const zoom = Math.max(
    1,
    calcBoundsZoom(minLat, maxLat, minLng, maxLng, requestedWidth, requestedHeight),
  );

  // Downsample route to stay well within the URL character limit.
  const pathPoints = downsample(validPoints, 100);
  const pathParam =
    pathPoints.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join("|");

  const staticUrl = new URL("https://maps.googleapis.com/maps/api/staticmap");
  staticUrl.searchParams.set("center", `${centerLat.toFixed(6)},${centerLng.toFixed(6)}`);
  staticUrl.searchParams.set("zoom", String(zoom));
  staticUrl.searchParams.set("size", `${requestedWidth}x${requestedHeight}`);
  staticUrl.searchParams.set("maptype", "roadmap");
  staticUrl.searchParams.set("path", `color:0x4A90E2FF|weight:3|${pathParam}`);
  staticUrl.searchParams.set("key", apiKey);

  const proxyUrl = `/api/map-proxy?url=${encodeURIComponent(staticUrl.toString())}`;

  return new Promise<StaticMapInfo | null>((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        image: img,
        centerLat,
        centerLng,
        zoom,
        pixelWidth: requestedWidth,
        pixelHeight: requestedHeight,
      });
    img.onerror = () => {
      console.warn("[StaticMapOverlay] Could not load static map image.");
      resolve(null);
    };
    img.src = proxyUrl;
  });
}

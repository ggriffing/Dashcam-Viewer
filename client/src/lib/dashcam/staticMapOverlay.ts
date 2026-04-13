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

const TILE_SIZE = 256;

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

function calcBoundsZoom(
  minLat: number, maxLat: number,
  minLng: number, maxLng: number,
  pxWidth: number, pxHeight: number,
): number {
  const latFraction = (latRadMercator(maxLat) - latRadMercator(minLat)) / Math.PI;
  const lngDiff = maxLng - minLng;
  const lngFraction = (lngDiff < 0 ? lngDiff + 360 : lngDiff) / 360;

  const latZoom = latFraction > 0
    ? Math.floor(Math.log(pxHeight / TILE_SIZE / latFraction) / Math.LN2) : 20;
  const lngZoom = lngFraction > 0
    ? Math.floor(Math.log(pxWidth / TILE_SIZE / lngFraction) / Math.LN2) : 20;

  return Math.min(Math.max(latZoom, 1), Math.max(lngZoom, 1), 19) - 1;
}

function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const result: T[] = [arr[0]];
  const step = (arr.length - 2) / (maxPoints - 2);
  for (let i = 1; i < maxPoints - 1; i++) result.push(arr[Math.round(i * step)]);
  result.push(arr[arr.length - 1]);
  return result;
}

export function latLngToMapPixel(
  lat: number, lng: number,
  centerLat: number, centerLng: number,
  zoom: number,
  imageWidth: number, imageHeight: number,
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

export async function fetchStaticMapImage(
  path: LatLng[],
  requestedWidth: number,
  requestedHeight: number,
): Promise<StaticMapInfo | null> {
  const validPoints = path.filter((p) => p.lat !== 0 || p.lng !== 0);
  if (validPoints.length === 0) return null;

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

  const pathPoints = downsample(validPoints, 100);
  const pathParam = pathPoints
    .map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`)
    .join("|");

  const params = new URLSearchParams({
    center: `${centerLat.toFixed(6)},${centerLng.toFixed(6)}`,
    zoom: String(zoom),
    size: `${requestedWidth}x${requestedHeight}`,
    path: `color:0x4A90E2FF|weight:3|${pathParam}`,
  });
  const proxyUrl = `/api/map-proxy?${params.toString()}`;

  return new Promise<StaticMapInfo | null>((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({ image: img, centerLat, centerLng, zoom, pixelWidth: requestedWidth, pixelHeight: requestedHeight });
    img.onerror = () => {
      console.warn("[StaticMapOverlay] Could not load static map image.");
      resolve(null);
    };
    img.src = proxyUrl;
  });
}

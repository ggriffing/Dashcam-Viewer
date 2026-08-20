export interface LatLng {
  lat: number;
  lng: number;
}

export type MapPanelState =
  | "no-gps"
  | "checking-availability"
  | "availability-error"
  | "not-configured"
  | "client-key-missing"
  | "load-error"
  | "loading"
  | "ready";

type MapsEnvironment = Record<string, string | undefined>;

export function hasGoogleMapsApiKey(environment: MapsEnvironment): boolean {
  return Boolean(
    environment.VITE_GOOGLE_MAPS_API_KEY || environment.VITE_GOOGLE_API_KEY,
  );
}

export function isUsableGpsPoint(point: LatLng | null | undefined): point is LatLng {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return false;
  }

  return (
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180 &&
    (point.lat !== 0 || point.lng !== 0)
  );
}

export function getUsableGpsPath(path: LatLng[]): LatLng[] {
  return path.filter(isUsableGpsPoint);
}

export function getGpsPositionAt(path: LatLng[], currentIndex: number): LatLng | null {
  if (path.length === 0) return null;

  const start = Math.max(0, Math.min(Math.floor(currentIndex), path.length - 1));
  if (isUsableGpsPoint(path[start])) return path[start];

  for (let index = start - 1; index >= 0; index -= 1) {
    if (isUsableGpsPoint(path[index])) return path[index];
  }

  for (let index = start + 1; index < path.length; index += 1) {
    if (isUsableGpsPoint(path[index])) return path[index];
  }

  return null;
}

export function getMapPanelState({
  hasGps,
  isCheckingAvailability,
  mapAvailabilityFailed,
  isServerConfigured,
  hasClientKey,
  loadError,
  isReady,
}: {
  hasGps: boolean;
  isCheckingAvailability: boolean;
  mapAvailabilityFailed: boolean;
  isServerConfigured: boolean;
  hasClientKey: boolean;
  loadError: boolean;
  isReady: boolean;
}): MapPanelState {
  if (!hasGps) return "no-gps";
  if (isCheckingAvailability) return "checking-availability";
  if (mapAvailabilityFailed) return "availability-error";
  if (!isServerConfigured) return "not-configured";
  if (!hasClientKey) return "client-key-missing";
  if (loadError) return "load-error";
  return isReady ? "ready" : "loading";
}
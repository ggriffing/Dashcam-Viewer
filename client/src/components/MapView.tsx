/// <reference types="google.maps" />
import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  loadGoogleMapsApi,
  subscribeToGoogleMapsAuthFailure,
} from "@/lib/googleMapsLoader";
import {
  getGpsPositionAt,
  getMapPanelState,
  getUsableGpsPath,
  type LatLng,
} from "@shared/mapNavigation";

export type { LatLng } from "@shared/mapNavigation";

interface MapViewProps {
  path: LatLng[];
  currentIndex: number;
  /**
   * These optional overrides let browser-style tests exercise the route view
   * without exposing a real browser key or requesting Google from Preview.
   */
  apiKey?: string;
  mapId?: string;
  mapsClient?: GoogleMapsClient;
}

interface MapAvailability {
  available: boolean;
}

export interface GoogleMapsClient {
  load: (apiKey: string) => Promise<void>;
  subscribeToAuthFailure: (listener: (message: string) => void) => () => void;
}

const browserMapsClient: GoogleMapsClient = {
  load: loadGoogleMapsApi,
  subscribeToAuthFailure: subscribeToGoogleMapsAuthFailure,
};

const TESLA_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 36" width="28" height="36">
  <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22S28 23.333 28 14C28 6.268 21.732 0 14 0z" fill="#E82127"/>
  <path d="M7 10h14v2H15v8h-2v-8H7z" fill="white"/>
  <path d="M9 10c0 0 1 1.5 5 1.5S19 10 19 10" stroke="white" stroke-width="1.5" fill="none"/>
</svg>`;

const TESLA_MARKER_URL = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(TESLA_MARKER_SVG)}`;
const DEFAULT_GOOGLE_MAP_ID = "63ac2b86b263753d3f12b01f";

function MapStatus({ title, detail, testId }: { title: string; detail: string; testId: string }) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-1 border-t border-[#393C41] bg-[#181818] px-4 text-center"
      data-testid={testId}
      aria-live="polite"
    >
      <span className="text-sm font-medium text-white/70">{title}</span>
      <span className="max-w-lg text-xs text-white/40">{detail}</span>
    </div>
  );
}

export function MapView({
  path,
  currentIndex,
  apiKey: apiKeyOverride,
  mapId: mapIdOverride,
  mapsClient = browserMapsClient,
}: MapViewProps) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const viteEnvironment = (import.meta.env ?? {}) as Record<string, string | undefined>;
  const configuredApiKey = (
    viteEnvironment.VITE_GOOGLE_MAPS_API_KEY ||
    viteEnvironment.VITE_GOOGLE_API_KEY
  );
  const apiKey = apiKeyOverride ?? configuredApiKey;
  const mapId = mapIdOverride ?? viteEnvironment.VITE_GOOGLE_MAP_ID ?? DEFAULT_GOOGLE_MAP_ID;

  const validPath = getUsableGpsPath(path);
  const hasGps = validPath.length > 0;
  const {
    data: mapAvailability,
    isError: mapAvailabilityFailed,
    isPending: isCheckingAvailability,
  } = useQuery<MapAvailability>({
    queryKey: ["/api/map-available"],
    enabled: hasGps,
  });
  const isServerConfigured = mapAvailability?.available === true;
  const canLoadMap = hasGps && isServerConfigured && Boolean(apiKey);

  useEffect(() => {
    setIsReady(false);
    setLoadError(null);
    if (!canLoadMap || !apiKey) return;

    let cancelled = false;
    const unsubscribeFromAuthFailure = mapsClient.subscribeToAuthFailure((message) => {
      if (!cancelled) {
        setIsReady(false);
        setLoadError(message);
      }
    });

    mapsClient.load(apiKey)
      .then(() => {
        if (!cancelled) setIsReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Google Maps could not be loaded");
        }
      });

    return () => {
      cancelled = true;
      unsubscribeFromAuthFailure();
    };
  }, [apiKey, canLoadMap, mapsClient]);

  useEffect(() => {
    if (!isReady || loadError || !mapDivRef.current || validPath.length === 0) return;

    const initialPos = getGpsPositionAt(path, currentIndex) ?? validPath[0];

    const map = new window.google.maps.Map(mapDivRef.current, {
      center: initialPos,
      mapId,
      zoom: 16,
      disableDefaultUI: true,
      zoomControl: true,
      zoomControlOptions: {
        position: window.google.maps.ControlPosition.RIGHT_BOTTOM,
      },
    });

    new window.google.maps.Polyline({
      path: validPath,
      geodesic: true,
      strokeColor: "#4A90E2",
      strokeOpacity: 0.9,
      strokeWeight: 3,
      map,
    });

    const markerContent = document.createElement("img");
    markerContent.src = TESLA_MARKER_URL;
    markerContent.alt = "Tesla vehicle position";
    markerContent.width = 28;
    markerContent.height = 36;
    markerContent.style.display = "block";

    const marker = new window.google.maps.marker.AdvancedMarkerElement({
      position: initialPos,
      map,
      content: markerContent,
      zIndex: 100,
    });

    const bounds = new window.google.maps.LatLngBounds();
    validPath.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, { top: 24, right: 24, bottom: 24, left: 24 });

    markerRef.current = marker;

    return () => {
      marker.map = null;
      markerRef.current = null;
    };
  }, [isReady, loadError, mapId, path]);

  useEffect(() => {
    if (!markerRef.current || path.length === 0) return;
    const pos = getGpsPositionAt(path, currentIndex);
    if (pos) {
      markerRef.current.position = pos;
    }
  }, [currentIndex, path]);

  const panelState = getMapPanelState({
    hasGps,
    isCheckingAvailability,
    mapAvailabilityFailed,
    isServerConfigured,
    hasClientKey: Boolean(apiKey),
    loadError: Boolean(loadError),
    isReady,
  });

  if (panelState === "no-gps") {
    return (
      <MapStatus
        testId="map-no-gps"
        title="Route unavailable"
        detail="This clip does not contain usable GPS navigation data."
      />
    );
  }

  if (panelState === "checking-availability") {
    return (
      <MapStatus
        testId="map-checking-availability"
        title="Checking map availability"
        detail="Preparing the recorded route map."
      />
    );
  }

  if (panelState === "availability-error") {
    return (
      <MapStatus
        testId="map-availability-error"
        title="Map unavailable"
        detail="The app could not confirm Google Maps availability. Try refreshing after signing in."
      />
    );
  }

  if (panelState === "not-configured") {
    return (
      <MapStatus
        testId="map-not-configured"
        title="Map unavailable"
        detail="Google Maps is not configured for this viewer."
      />
    );
  }

  if (panelState === "client-key-missing") {
    return (
      <MapStatus
        testId="map-client-key-missing"
        title="Map unavailable"
        detail="The browser Maps key is unavailable. Reload the viewer after the Maps configuration is updated."
      />
    );
  }

  if (panelState === "load-error") {
    return (
      <MapStatus
        testId="map-error"
        title="Map unavailable"
        detail={`${loadError}. Check that the Google Maps JavaScript API is enabled for this key.`}
      />
    );
  }

  if (panelState === "loading") {
    return (
      <MapStatus
        testId="map-loading"
        title="Loading route map"
        detail="Drawing the recorded route and current vehicle position."
      />
    );
  }

  return (
    <div
      className="h-full w-full border-t border-[#393C41]"
    >
      <div
        ref={mapDivRef}
        className="h-full w-full"
        data-testid="map-view"
      />
    </div>
  );
}

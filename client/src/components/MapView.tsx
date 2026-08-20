/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
}

interface MapAvailability {
  available: boolean;
}

declare global {
  interface Window {
    __dashcamGoogleMapsInit?: () => void;
    gm_authFailure?: () => void;
  }
}

let googleMapsLoadPromise: Promise<void> | null = null;
const GOOGLE_MAPS_LOAD_TIMEOUT_MS = 15_000;
const googleMapsAuthFailureListeners = new Set<(message: string) => void>();
let previousGoogleMapsAuthFailure: (() => void) | undefined;
let isGoogleMapsAuthFailureHandlerInstalled = false;

function subscribeToGoogleMapsAuthFailure(listener: (message: string) => void) {
  if (!isGoogleMapsAuthFailureHandlerInstalled) {
    previousGoogleMapsAuthFailure = window.gm_authFailure;
    window.gm_authFailure = () => {
      previousGoogleMapsAuthFailure?.();
      googleMapsAuthFailureListeners.forEach((notify) => {
        notify("Google Maps rejected the configured API key");
      });
    };
    isGoogleMapsAuthFailureHandlerInstalled = true;
  }

  googleMapsAuthFailureListeners.add(listener);

  return () => {
    googleMapsAuthFailureListeners.delete(listener);
    if (googleMapsAuthFailureListeners.size > 0 || !isGoogleMapsAuthFailureHandlerInstalled) {
      return;
    }

    if (previousGoogleMapsAuthFailure) {
      window.gm_authFailure = previousGoogleMapsAuthFailure;
    } else {
      delete window.gm_authFailure;
    }
    previousGoogleMapsAuthFailure = undefined;
    isGoogleMapsAuthFailureHandlerInstalled = false;
  };
}

function loadGoogleMapsApi(apiKey: string): Promise<void> {
  if (window.google?.maps) {
    return Promise.resolve();
  }

  if (googleMapsLoadPromise) {
    return googleMapsLoadPromise;
  }

  const loader = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;
    const timeout = window.setTimeout(
      () => fail("Google Maps took too long to load"),
      GOOGLE_MAPS_LOAD_TIMEOUT_MS,
    );
    const unsubscribeFromAuthFailure = subscribeToGoogleMapsAuthFailure((message) => fail(message));

    const cleanup = () => {
      window.clearTimeout(timeout);
      unsubscribeFromAuthFailure();
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      script.remove();
      cleanup();
      reject(new Error(message));
    };

    window.__dashcamGoogleMapsInit = () => {
      if (settled) return;
      if (!window.google?.maps) {
        fail("Google Maps did not initialize");
        return;
      }

      settled = true;
      cleanup();
      resolve();
    };

    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=__dashcamGoogleMapsInit`;
    script.async = true;
    script.defer = true;
    script.onerror = () => fail("Google Maps script failed to load");
    document.head.appendChild(script);
  }).catch((error) => {
    googleMapsLoadPromise = null;
    throw error;
  });

  googleMapsLoadPromise = loader;
  return loader;
}

const TESLA_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 36" width="28" height="36">
  <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22S28 23.333 28 14C28 6.268 21.732 0 14 0z" fill="#E82127"/>
  <path d="M7 10h14v2H15v8h-2v-8H7z" fill="white"/>
  <path d="M9 10c0 0 1 1.5 5 1.5S19 10 19 10" stroke="white" stroke-width="1.5" fill="none"/>
</svg>`;

const TESLA_MARKER_URL = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(TESLA_MARKER_SVG)}`;

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

export function MapView({ path, currentIndex }: MapViewProps) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const apiKey = (
    (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ||
    (import.meta.env.VITE_GOOGLE_API_KEY as string | undefined)
  );

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
    const unsubscribeFromAuthFailure = subscribeToGoogleMapsAuthFailure((message) => {
      if (!cancelled) {
        setIsReady(false);
        setLoadError(message);
      }
    });

    loadGoogleMapsApi(apiKey)
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
  }, [apiKey, canLoadMap]);

  useEffect(() => {
    if (!isReady || loadError || !mapDivRef.current || validPath.length === 0) return;

    const initialPos = getGpsPositionAt(path, currentIndex) ?? validPath[0];

    const map = new window.google.maps.Map(mapDivRef.current, {
      center: initialPos,
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

    const marker = new window.google.maps.Marker({
      position: initialPos,
      map,
      icon: {
        url: TESLA_MARKER_URL,
        scaledSize: new window.google.maps.Size(28, 36),
        anchor: new window.google.maps.Point(14, 36),
      },
      zIndex: 100,
    });

    const bounds = new window.google.maps.LatLngBounds();
    validPath.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, { top: 24, right: 24, bottom: 24, left: 24 });

    markerRef.current = marker;

    return () => {
      marker.setMap(null);
      markerRef.current = null;
    };
  }, [isReady, loadError, path]);

  useEffect(() => {
    if (!markerRef.current || path.length === 0) return;
    const pos = getGpsPositionAt(path, currentIndex);
    if (pos) {
      markerRef.current.setPosition(pos);
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

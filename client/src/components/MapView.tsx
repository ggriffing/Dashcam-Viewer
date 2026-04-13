/// <reference types="@types/google.maps" />
import { useEffect, useRef, useState } from "react";

export interface LatLng {
  lat: number;
  lng: number;
}

interface MapViewProps {
  path: LatLng[];
  currentIndex: number;
}

declare global {
  interface Window {
    __gmapsInitCallbacks?: Array<() => void>;
    __gmapsScriptLoading?: boolean;
    __gmapsInit?: () => void;
  }
}

function loadGoogleMapsApi(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve();
      return;
    }

    if (!window.__gmapsInitCallbacks) {
      window.__gmapsInitCallbacks = [];
    }
    window.__gmapsInitCallbacks.push(resolve);

    if (!window.__gmapsScriptLoading) {
      window.__gmapsScriptLoading = true;
      window.__gmapsInit = () => {
        window.__gmapsInitCallbacks?.forEach((cb) => cb());
        window.__gmapsInitCallbacks = [];
      };
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=__gmapsInit`;
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        console.error("[MapView] Failed to load Google Maps JavaScript API. Check that VITE_GOOGLE_MAPS_API_KEY is valid and the Maps JavaScript API is enabled.");
        window.__gmapsScriptLoading = false;
        window.__gmapsInitCallbacks = [];
        reject(new Error("Google Maps script failed to load"));
      };
      document.head.appendChild(script);
    }
  });
}

const TESLA_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 36" width="28" height="36">
  <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22S28 23.333 28 14C28 6.268 21.732 0 14 0z" fill="#E82127"/>
  <path d="M7 10h14v2H15v8h-2v-8H7z" fill="white"/>
  <path d="M9 10c0 0 1 1.5 5 1.5S19 10 19 10" stroke="white" stroke-width="1.5" fill="none"/>
</svg>`;

const TESLA_MARKER_URL = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(TESLA_MARKER_SVG)}`;

export function MapView({ path, currentIndex }: MapViewProps) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const pathKeyRef = useRef<number>(0);
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const apiKey = (
    (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ||
    (import.meta.env.VITE_GOOGLE_API_KEY as string | undefined)
  );

  const validPath = path.filter((p) => p.lat !== 0 || p.lng !== 0);
  const hasGps = validPath.length > 0;

  useEffect(() => {
    if (!apiKey || !hasGps) return;
    loadGoogleMapsApi(apiKey)
      .then(() => setIsReady(true))
      .catch(() => setLoadError(true));
  }, [apiKey, hasGps]);

  useEffect(() => {
    if (!isReady || !mapDivRef.current || validPath.length === 0) return;

    const currentPathKey = path.length;
    if (mapRef.current && pathKeyRef.current === currentPathKey) return;
    pathKeyRef.current = currentPathKey;

    const initialPos =
      (path[currentIndex]?.lat !== 0 || path[currentIndex]?.lng !== 0
        ? path[currentIndex]
        : null) ?? validPath[0];

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

    const currentPos = path[currentIndex];
    const markerPos =
      currentPos && (currentPos.lat !== 0 || currentPos.lng !== 0)
        ? currentPos
        : validPath[0];

    const marker = new window.google.maps.Marker({
      position: markerPos,
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

    mapRef.current = map;
    markerRef.current = marker;
  }, [isReady, path]);

  useEffect(() => {
    if (!markerRef.current || path.length === 0) return;
    const pos = path[currentIndex];
    if (pos && (pos.lat !== 0 || pos.lng !== 0)) {
      markerRef.current.setPosition(pos);
    }
  }, [currentIndex, path]);

  if (!apiKey || !hasGps) return null;

  if (loadError) {
    return (
      <div
        className="flex-shrink-0 w-full border-t border-[#393C41] bg-[#181818] flex items-center justify-center"
        style={{ height: "180px" }}
        data-testid="map-error"
      >
        <span className="text-sm text-white/30">
          Map unavailable — check your Google Maps API key
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex-shrink-0 w-full border-t border-[#393C41]"
      style={{ height: "180px" }}
    >
      <div
        ref={mapDivRef}
        className="w-full h-full"
        data-testid="map-view"
      />
    </div>
  );
}

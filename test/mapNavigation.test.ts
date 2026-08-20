import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createGoogleMapsLoader,
  type GoogleMapsDocument,
  type GoogleMapsRuntime,
  type GoogleMapsScript,
} from "../client/src/lib/googleMapsLoader";
import {
  MapView,
  type GoogleMapsClient,
} from "../client/src/components/MapView";
import {
  getGpsPositionAt,
  getMapPanelState,
  getUsableGpsPath,
  hasGoogleMapsApiKey,
  isUsableGpsPoint,
} from "../shared/mapNavigation";

interface FakeMapsEnvironment {
  runtime: GoogleMapsRuntime;
  document: GoogleMapsDocument;
  scripts: FakeScript[];
  originalAuthFailure: () => void;
}

type FakeScript = GoogleMapsScript & { removed: boolean };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

interface BrowserMapHarness {
  dom: JSDOM;
  container: HTMLDivElement;
  root: Root;
  mapsClient: GoogleMapsClient & {
    requestedKeys: string[];
    listenerCount: () => number;
    notifyAuthFailure: (message?: string) => void;
    pendingLoad: Deferred<void>;
  };
  render: (currentIndex?: number) => Promise<void>;
  unmount: () => Promise<void>;
  restore: () => void;
}

const route = [
  { lat: 37.4219999, lng: -122.0840575 },
  { lat: 0, lng: 0 },
  { lat: 37.4225, lng: -122.085 },
];

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createMockMapsClient() {
  const listeners = new Set<(message: string) => void>();
  const requestedKeys: string[] = [];
  const pendingLoad = createDeferred<void>();

  return {
    requestedKeys,
    pendingLoad,
    load: (apiKey: string) => {
      requestedKeys.push(apiKey);
      return pendingLoad.promise;
    },
    subscribeToAuthFailure: (listener: (message: string) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    listenerCount: () => listeners.size,
    notifyAuthFailure: (message = "Google Maps rejected the configured API key") => {
      listeners.forEach((listener) => listener(message));
    },
  };
}

function installBrowserMapHarness(): BrowserMapHarness {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "https://preview.invalid/",
  });
  const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
  const globals: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };

  for (const [name, value] of Object.entries(globals)) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  }

  const container = dom.window.document.querySelector<HTMLDivElement>("#root");
  assert.ok(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: async () => ({ available: true }),
        retry: false,
      },
    },
  });
  const mapsClient = createMockMapsClient();

  const render = async (currentIndex = 0) => {
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(MapView, {
            path: route,
            currentIndex,
            apiKey: "mocked-browser-key",
            mapsClient,
          }),
        ),
      );
    });
  };

  return {
    dom,
    container,
    root,
    mapsClient,
    render,
    unmount: async () => {
      await act(async () => root.unmount());
      queryClient.clear();
    },
    restore: () => {
      dom.window.close();
      for (const [name, descriptor] of originalGlobals) {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor);
        } else {
          delete (globalThis as Record<string, unknown>)[name];
        }
      }
    },
  };
}

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }
  throw lastError;
}

function createFakeMapsEnvironment(): FakeMapsEnvironment {
  const originalAuthFailure = () => undefined;
  const runtime: GoogleMapsRuntime = { gm_authFailure: originalAuthFailure };
  const scripts: FakeScript[] = [];
  const document: GoogleMapsDocument = {
    createElement: () => {
      const script: FakeScript = {
        src: "",
        async: false,
        defer: false,
        onerror: null,
        removed: false,
        remove() {
          this.removed = true;
        },
      };
      scripts.push(script);
      return script;
    },
    head: {
      appendChild: () => undefined,
    },
  };

  return { runtime, document, scripts, originalAuthFailure };
}

describe("map navigation helpers", () => {
  it("supports both configured Google Maps key names", () => {
    assert.equal(hasGoogleMapsApiKey({}), false);
    assert.equal(hasGoogleMapsApiKey({ VITE_GOOGLE_API_KEY: "legacy-key" }), true);
    assert.equal(hasGoogleMapsApiKey({ VITE_GOOGLE_MAPS_API_KEY: "maps-key" }), true);
  });

  it("keeps only usable Tesla GPS coordinates", () => {
    const path = [
      { lat: 0, lng: 0 },
      { lat: 37.4219999, lng: -122.0840575 },
      { lat: 91, lng: 0 },
      { lat: Number.NaN, lng: 3 },
    ];

    assert.equal(isUsableGpsPoint(path[0]), false);
    assert.deepEqual(getUsableGpsPath(path), [path[1]]);
  });

  it("holds the marker at the nearest known position when telemetry omits a frame", () => {
    const route = [
      { lat: 37.4, lng: -122.0 },
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0 },
      { lat: 37.5, lng: -122.1 },
    ];

    assert.deepEqual(getGpsPositionAt(route, 0), route[0]);
    assert.deepEqual(getGpsPositionAt(route, 1), route[0]);
    assert.deepEqual(getGpsPositionAt(route, 3), route[3]);
    assert.equal(getGpsPositionAt([{ lat: 0, lng: 0 }], 0), null);
  });

  it("selects a visible panel state for every Maps capability outcome", () => {
    const ready = {
      hasGps: true,
      isCheckingAvailability: false,
      mapAvailabilityFailed: false,
      isServerConfigured: true,
      hasClientKey: true,
      loadError: false,
      isReady: true,
    };

    assert.equal(getMapPanelState({ ...ready, hasGps: false }), "no-gps");
    assert.equal(getMapPanelState({ ...ready, isCheckingAvailability: true }), "checking-availability");
    assert.equal(getMapPanelState({ ...ready, mapAvailabilityFailed: true }), "availability-error");
    assert.equal(getMapPanelState({ ...ready, isServerConfigured: false }), "not-configured");
    assert.equal(getMapPanelState({ ...ready, hasClientKey: false }), "client-key-missing");
    assert.equal(getMapPanelState({ ...ready, loadError: true }), "load-error");
    assert.equal(getMapPanelState({ ...ready, isReady: false }), "loading");
    assert.equal(getMapPanelState(ready), "ready");
  });

  it("shares one script request and resolves all waiting callers", async () => {
    const environment = createFakeMapsEnvironment();
    const loader = createGoogleMapsLoader(environment.runtime, environment.document);

    const first = loader.load("first-key");
    const second = loader.load("second-key");

    assert.equal(environment.scripts.length, 1);
    assert.match(environment.scripts[0].src, /key=first-key/);

    environment.runtime.google = { maps: {} };
    environment.runtime.__dashcamGoogleMapsInit?.();
    await Promise.all([first, second]);
    assert.equal(environment.scripts[0].removed, false);
  });

  it("rejects and removes a script that never initializes", async () => {
    const environment = createFakeMapsEnvironment();
    const loader = createGoogleMapsLoader(environment.runtime, environment.document, {
      timeoutMs: 5,
    });

    await assert.rejects(loader.load("blocked-key"), /too long to load/);
    assert.equal(environment.scripts[0].removed, true);
  });

  it("rejects and removes a script when the browser reports a network error", async () => {
    const environment = createFakeMapsEnvironment();
    const loader = createGoogleMapsLoader(environment.runtime, environment.document);
    const pending = loader.load("offline-key");

    environment.scripts[0].onerror?.();

    await assert.rejects(pending, /script failed to load/);
    assert.equal(environment.scripts[0].removed, true);
  });

  it("reports late authorization failures and restores the original handler after cleanup", async () => {
    const environment = createFakeMapsEnvironment();
    const loader = createGoogleMapsLoader(environment.runtime, environment.document);
    const messages: string[] = [];
    const unsubscribe = loader.subscribeToAuthFailure((message) => messages.push(message));

    const pending = loader.load("restricted-key");
    environment.runtime.google = { maps: {} };
    environment.runtime.__dashcamGoogleMapsInit?.();
    await pending;

    environment.runtime.gm_authFailure?.();
    assert.deepEqual(messages, ["Google Maps rejected the configured API key"]);

    unsubscribe();
    assert.equal(environment.runtime.gm_authFailure, environment.originalAuthFailure);
  });

  it("keeps the global authorization handler while another map is subscribed", () => {
    const environment = createFakeMapsEnvironment();
    const loader = createGoogleMapsLoader(environment.runtime, environment.document);
    const first = loader.subscribeToAuthFailure(() => undefined);
    const second = loader.subscribeToAuthFailure(() => undefined);
    const sharedHandler = environment.runtime.gm_authFailure;

    first();
    assert.equal(environment.runtime.gm_authFailure, sharedHandler);

    second();
    assert.equal(environment.runtime.gm_authFailure, environment.originalAuthFailure);
  });

  it("changes a stalled route panel from loading to an unavailable message", async () => {
    const harness = installBrowserMapHarness();
    try {
      await harness.render();
      await waitFor(() => {
        assert.equal(harness.container.querySelector("[data-testid='map-loading']")?.textContent?.includes("Loading route map"), true);
      });

      await act(async () => {
        harness.mapsClient.pendingLoad.reject(new Error("Google Maps took too long to load"));
        await Promise.resolve();
      });

      await waitFor(() => {
        const status = harness.container.querySelector("[data-testid='map-error']");
        assert.ok(status);
        assert.match(status.textContent ?? "", /Map unavailable/);
        assert.match(status.textContent ?? "", /took too long to load/);
      });
    } finally {
      await harness.unmount();
      harness.restore();
    }
  });

  it("shows an unavailable route panel when authorization fails after loading begins", async () => {
    const harness = installBrowserMapHarness();
    try {
      await harness.render();
      await waitFor(() => assert.equal(harness.mapsClient.listenerCount(), 1));

      await act(async () => {
        harness.mapsClient.notifyAuthFailure();
        harness.mapsClient.pendingLoad.reject(new Error("Google Maps rejected the configured API key"));
        await Promise.resolve();
      });

      await waitFor(() => {
        const status = harness.container.querySelector("[data-testid='map-error']");
        assert.ok(status);
        assert.match(status.textContent ?? "", /rejected the configured API key/);
      });
    } finally {
      await harness.unmount();
      harness.restore();
    }
  });

  it("cleans up a route viewer subscription when the viewer unmounts", async () => {
    const harness = installBrowserMapHarness();
    try {
      await harness.render();
      await waitFor(() => assert.equal(harness.mapsClient.listenerCount(), 1));

      await harness.unmount();
      assert.equal(harness.mapsClient.listenerCount(), 0);

      harness.mapsClient.notifyAuthFailure();
      harness.mapsClient.pendingLoad.reject(new Error("Google Maps rejected the configured API key"));
      await Promise.resolve();
      assert.equal(harness.container.textContent, "");
    } finally {
      harness.restore();
    }
  });

  it("creates the mocked route and synchronizes the marker after a successful load", async () => {
    const harness = installBrowserMapHarness();
    const markerPositions: Array<{ lat: number; lng: number }> = [];
    const markerMaps: unknown[] = [];
    const polylines: unknown[] = [];
    const fittedBounds: unknown[] = [];
    const mapInstances: unknown[] = [];

    try {
      const maps = {
        ControlPosition: { RIGHT_BOTTOM: 1 },
        Map: function MockMap(_element: Element, options: unknown) {
          const map = {
            options,
            fitBounds: (bounds: unknown) => fittedBounds.push(bounds),
          };
          mapInstances.push(map);
          return map;
        },
        Polyline: function MockPolyline(options: unknown) {
          polylines.push(options);
        },
        Marker: function MockMarker(options: { position: { lat: number; lng: number } }) {
          markerPositions.push(options.position);
          return {
            setPosition: (position: { lat: number; lng: number }) => markerPositions.push(position),
            setMap: (map: unknown) => markerMaps.push(map),
          };
        },
        Size: function MockSize(width: number, height: number) {
          return { width, height };
        },
        Point: function MockPoint(x: number, y: number) {
          return { x, y };
        },
        LatLngBounds: function MockLatLngBounds() {
          return { extend: () => undefined };
        },
      };
      (window as unknown as { google: { maps: unknown } }).google = { maps };

      await harness.render();
      await act(async () => {
        harness.mapsClient.pendingLoad.resolve();
        await Promise.resolve();
      });

      await waitFor(() => assert.ok(harness.container.querySelector("[data-testid='map-view']")));
      assert.equal(mapInstances.length, 1);
      assert.equal(polylines.length, 1);
      assert.equal(fittedBounds.length, 1);
      assert.deepEqual(markerPositions, [route[0]]);

      await harness.render(2);
      await waitFor(() => assert.deepEqual(markerPositions, [route[0], route[2]]));

      await harness.unmount();
      assert.deepEqual(markerMaps, [null]);
    } finally {
      harness.restore();
    }
  });
});
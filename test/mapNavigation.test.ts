import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createGoogleMapsLoader,
  type GoogleMapsDocument,
  type GoogleMapsRuntime,
  type GoogleMapsScript,
} from "../client/src/lib/googleMapsLoader";
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
});
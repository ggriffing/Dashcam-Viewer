import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getGpsPositionAt,
  getMapPanelState,
  getUsableGpsPath,
  hasGoogleMapsApiKey,
  isUsableGpsPoint,
} from "../shared/mapNavigation";

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
});
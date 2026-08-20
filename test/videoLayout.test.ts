import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getFittedSingleCameraSize } from "../client/src/components/VideoGrid";

describe("single front-camera layout", () => {
  it("fits the complete source frame inside wide, medium, and narrow viewports", () => {
    const sourceAspectRatio = 16 / 9;
    const viewports = [
      { width: 1440, height: 420 },
      { width: 900, height: 700 },
      { width: 360, height: 700 },
    ];

    for (const viewport of viewports) {
      const size = getFittedSingleCameraSize(
        viewport.width,
        viewport.height,
        sourceAspectRatio,
      );

      assert.ok(size);
      assert.ok(size.width <= viewport.width);
      assert.ok(size.height <= viewport.height);
      assert.ok(Math.abs(size.width / size.height - sourceAspectRatio) < 0.00001);
    }
  });

  it("does not calculate a frame size from unusable measurements", () => {
    assert.equal(getFittedSingleCameraSize(0, 400, 16 / 9), null);
    assert.equal(getFittedSingleCameraSize(400, 0, 16 / 9), null);
    assert.equal(getFittedSingleCameraSize(400, 400, 0), null);
  });
});
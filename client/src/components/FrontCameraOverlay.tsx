import { useRef } from "react";
import type { SeiMetadataRaw } from "@/lib/dashcam/types";

interface FrontCameraOverlayProps {
  metadata: SeiMetadataRaw | null;
}

const N_ROWS = 4;
const SVG_W = 360;
const HW = 130;          // half-width of each chevron arm
const CHEV_H = 44;       // vertical drop from wings to point
const STROKE_W = 18;     // arm stroke width (road-marking weight)
const SHADOW_EXTRA = 6;  // extra width added to shadow stroke
const GAP = 10;          // gap between stacked chevron rows
const ROW_STEP = CHEV_H + GAP;
const VPAD = 12;         // vertical padding so stroke tips aren't clipped
const SVG_H = N_ROWS * ROW_STEP + VPAD * 2;
const CX = SVG_W / 2;

const BLUE = "#3B82F6";
const LIT_OPACITY = 0.82;
const DIM_OPACITY = 0.10;
const SHADOW_OPACITY = 0.55;

const FLIP_TRANSFORM = `scale(1,-1) translate(0,${-SVG_H})`;
const OVERLAY_STYLE: React.CSSProperties = { paddingBottom: "8%" };

function makeChevronPath(row: number): string {
  const yWings = VPAD + (N_ROWS - 1 - row) * ROW_STEP;
  const yPoint = yWings + CHEV_H;
  return `M${CX - HW},${yWings} L${CX},${yPoint} L${CX + HW},${yWings}`;
}

const PATHS = Array.from({ length: N_ROWS }, (_, i) => makeChevronPath(i));

function accelToLit(ax: number): number {
  const a = Math.abs(ax);
  if (a < 0.5) return 1;
  if (a < 1.5) return 2;
  if (a < 3.0) return 3;
  return 4;
}

function hasData(m: SeiMetadataRaw): boolean {
  return (
    m.linearAccelerationMps2X !== undefined ||
    m.acceleratorPedalPosition !== undefined ||
    m.brakeApplied !== undefined
  );
}

type DriveState = "accel" | "brake" | "coast";

function getState(m: SeiMetadataRaw): { state: DriveState; litCount: number } {
  const ax = m.linearAccelerationMps2X;
  if (ax !== undefined) {
    if (ax > 0.5) return { state: "accel", litCount: accelToLit(ax) };
    if (ax < -0.5) return { state: "brake", litCount: accelToLit(ax) };
    return { state: "coast", litCount: 0 };
  }
  if (m.brakeApplied) return { state: "brake", litCount: 3 };
  const pedal = m.acceleratorPedalPosition ?? 0;
  if (pedal > 0.05) return { state: "accel", litCount: Math.max(1, Math.round(pedal * N_ROWS)) };
  return { state: "coast", litCount: 0 };
}

export function FrontCameraOverlay({ metadata }: FrontCameraOverlayProps) {
  const lastVisibleRef = useRef<{ state: DriveState; litCount: number } | null>(null);

  const noData = !metadata || !hasData(metadata);
  const speed = metadata?.vehicleSpeedMps ?? -1;

  let visible = false;
  let state: DriveState = "coast";
  let litCount = 0;

  if (!noData && speed !== 0) {
    const result = getState(metadata!);
    state = result.state;
    litCount = result.litCount;
    if (state !== "coast") {
      visible = true;
      lastVisibleRef.current = { state, litCount };
    }
  }

  const display = visible
    ? { state, litCount }
    : lastVisibleRef.current ?? { state: "accel" as DriveState, litCount: 0 };

  const isBrake = display.state === "brake";

  return (
    <div
      className="absolute inset-0 flex items-end justify-center pointer-events-none"
      style={{
        ...OVERLAY_STYLE,
        opacity: visible ? 1 : 0,
        transition: "opacity 120ms ease-out",
      }}
    >
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="48%"
        style={{ display: "block" }}
      >
        <g transform={isBrake ? FLIP_TRANSFORM : undefined}>
          {PATHS.map((d, row) => (
            <path
              key={`shadow-${row}`}
              d={d}
              fill="none"
              stroke="black"
              strokeWidth={STROKE_W + SHADOW_EXTRA}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeOpacity={SHADOW_OPACITY}
            />
          ))}
          {PATHS.map((d, row) => (
            <path
              key={`blue-${row}`}
              d={d}
              fill="none"
              stroke={BLUE}
              strokeWidth={STROKE_W}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeOpacity={row < display.litCount ? LIT_OPACITY : DIM_OPACITY}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

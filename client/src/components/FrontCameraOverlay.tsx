import { useRef } from "react";
import type { SeiMetadataRaw } from "@/lib/dashcam/types";

interface FrontCameraOverlayProps {
  metadata: SeiMetadataRaw | null;
}

const N_ROWS = 4;
const SVG_W = 360;
const HW = 150;        // half-width of each chevron arm
const CHEV_H = 40;     // vertical drop: wings (top) to tip (bottom)
const THICK = 14;      // arm thickness at the wing tops (tapers toward tip)
const GAP = 10;        // vertical gap between stacked rows
const ROW_H = CHEV_H + GAP;
const VPAD = 4;        // top padding to prevent wing-tip clipping
const SVG_H = ROW_H * N_ROWS + VPAD;
const CX = SVG_W / 2;

const BLUE = "#3B82F6";
const LIT_OPACITY = 0.75;
const DIM_OPACITY = 0.12;
const SHADOW_OPACITY = 0.55;

const FLIP_TRANSFORM = `scale(1,-1) translate(0,${-SVG_H})`;
const OVERLAY_STYLE: React.CSSProperties = { paddingBottom: "8%" };

function makeDownPath(row: number): string {
  const yP = VPAD + (N_ROWS - 1 - row) * ROW_H;
  const tipInner = Math.round(THICK * CHEV_H / HW);
  return (
    `M${CX - HW},${yP}` +
    ` L${CX},${yP + CHEV_H}` +
    ` L${CX + HW},${yP}` +
    ` L${CX + HW},${yP + THICK}` +
    ` L${CX},${yP + CHEV_H - tipInner}` +
    ` L${CX - HW},${yP + THICK}Z`
  );
}

const PATHS = Array.from({ length: N_ROWS }, (_, i) => makeDownPath(i));

function accelToLit(ax: number): number {
  const a = Math.abs(ax);
  if (a < 1) return 1;
  if (a < 2) return 2;
  if (a < 4) return 3;
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
            <path key={`shadow-${row}`} d={d} fill="black" fillOpacity={SHADOW_OPACITY} />
          ))}
          {PATHS.map((d, row) => (
            <path
              key={`blue-${row}`}
              d={d}
              fill={BLUE}
              fillOpacity={row < display.litCount ? LIT_OPACITY : DIM_OPACITY}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

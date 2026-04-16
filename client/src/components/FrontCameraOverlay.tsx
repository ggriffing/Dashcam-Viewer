import { useRef } from "react";
import type { SeiMetadataRaw } from "@/lib/dashcam/types";

interface FrontCameraOverlayProps {
  metadata: SeiMetadataRaw | null;
}

const SVG_W = 400;
const CX = SVG_W / 2;

// Each row pre-computed with perspective taper:
//   index 0 = topmost in SVG (farthest away, narrowest, last to light)
//   index 3 = bottommost in SVG (closest, widest, first to light)
// litIndex: row lights up when litIndex < litCount (0 = first to light)
const ROWS = [
  { hw: 58,  ch: 13, thick: 5,  y: 6,   shadowDY: 4, litIndex: 3 },
  { hw: 92,  ch: 22, thick: 8,  y: 28,  shadowDY: 5, litIndex: 2 },
  { hw: 126, ch: 32, thick: 11, y: 62,  shadowDY: 6, litIndex: 1 },
  { hw: 156, ch: 40, thick: 14, y: 107, shadowDY: 8, litIndex: 0 },
] as const;

// Bottom of last row: y(107) + ch(40) + thick(14) + padding(8)
const SVG_H = 169;

const BRIGHT_BLUE = "#38BDF8";
const SHADOW_COLOR = "#1E3A8A";
const LIT_OPACITY = 0.88;
const DIM_OPACITY = 0.10;
const SHADOW_OPACITY = 0.72;

const FLIP_TRANSFORM = `scale(1,-1) translate(0,${-SVG_H})`;
const OVERLAY_STYLE: React.CSSProperties = { paddingBottom: "8%" };

function makeChevronPath(hw: number, ch: number, thick: number, y: number): string {
  const tipInner = Math.round(thick * ch / hw);
  return (
    `M${CX - hw},${y}` +
    ` L${CX},${y + ch}` +
    ` L${CX + hw},${y}` +
    ` L${CX + hw},${y + thick}` +
    ` L${CX},${y + ch - tipInner}` +
    ` L${CX - hw},${y + thick}Z`
  );
}

// Pre-compute paths and their downward-shifted shadow paths
const ROW_PATHS = ROWS.map(r => makeChevronPath(r.hw, r.ch, r.thick, r.y));
const SHADOW_PATHS = ROWS.map(r =>
  makeChevronPath(r.hw, r.ch, r.thick, r.y + r.shadowDY)
);

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
  if (pedal > 0.05) return { state: "accel", litCount: Math.max(1, Math.round(pedal * 4)) };
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
        width="52%"
        style={{ display: "block" }}
      >
        <g transform={isBrake ? FLIP_TRANSFORM : undefined}>
          {/* 3D extrusion shadow: shifted downward so it peeks below the main face */}
          {ROWS.map((r, i) => (
            <path
              key={`shadow-${i}`}
              d={SHADOW_PATHS[i]}
              fill={SHADOW_COLOR}
              fillOpacity={r.litIndex < display.litCount ? SHADOW_OPACITY : DIM_OPACITY * 0.5}
            />
          ))}
          {/* Bright blue top face */}
          {ROWS.map((r, i) => (
            <path
              key={`blue-${i}`}
              d={ROW_PATHS[i]}
              fill={BRIGHT_BLUE}
              fillOpacity={r.litIndex < display.litCount ? LIT_OPACITY : DIM_OPACITY}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

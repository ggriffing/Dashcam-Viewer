import { useRef } from "react";
import type { SeiMetadataRaw } from "@/lib/dashcam/types";

interface FrontCameraOverlayProps {
  metadata: SeiMetadataRaw | null;
}

const N_ROWS = 4;
const SVG_W = 520;
const CX = SVG_W / 2;

// Rows with true perspective foreshortening (hw:ch ≈ 10:1 for all):
//   index 0 = topmost in SVG (farthest/narrowest, litIndex=3, last to light)
//   index 3 = bottommost in SVG (closest/widest, litIndex=0, first to light)
// Y gaps taper: 8px (top) → 11px → 15px (bottom) to reinforce perspective.
const ROWS = [
  { hw: 75,  ch: 8,  thick: 4,  y: 5,  shadowDY: 3, litIndex: 3 },
  { hw: 110, ch: 11, thick: 6,  y: 25, shadowDY: 4, litIndex: 2 },
  { hw: 160, ch: 16, thick: 8,  y: 53, shadowDY: 6, litIndex: 1 },
  { hw: 220, ch: 22, thick: 10, y: 92, shadowDY: 8, litIndex: 0 },
] as const;

// y(92) + ch(22) + thick(10) + bottom-pad(6) = 130
const SVG_H = 130;

const BRAKE_COLOR  = "#38BDF8"; // bright sky blue for braking
const ACCEL_COLOR  = "#F59E0B"; // amber for acceleration
const GREY_COLOR   = "#888888"; // desaturated grey at low intensity
const SHADOW_COLOR = "#0F2444"; // dark navy for 3D depth extrusion

const LIT_OPACITY         = 0.90;
const DIM_OPACITY         = 0.35; // raised so all rows always visible
const SHADOW_LIT_OPACITY  = 0.68;
const SHADOW_DIM_OPACITY  = 0.14;

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

const ROW_PATHS    = ROWS.map(r => makeChevronPath(r.hw, r.ch, r.thick, r.y));
const SHADOW_PATHS = ROWS.map(r => makeChevronPath(r.hw, r.ch, r.thick, r.y + r.shadowDY));

function lerpColor(from: string, to: string, t: number): string {
  const r1 = parseInt(from.slice(1, 3), 16), r2 = parseInt(to.slice(1, 3), 16);
  const g1 = parseInt(from.slice(3, 5), 16), g2 = parseInt(to.slice(3, 5), 16);
  const b1 = parseInt(from.slice(5, 7), 16), b2 = parseInt(to.slice(5, 7), 16);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
}

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

interface DisplayState {
  state: DriveState;
  litCount: number;
  ay: number;
}

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
  const lastVisibleRef = useRef<DisplayState | null>(null);

  const noData = !metadata || !hasData(metadata);
  const speed = metadata?.vehicleSpeedMps ?? -1;

  let visible = false;
  let state: DriveState = "coast";
  let litCount = 0;
  let ay = 0;

  if (!noData && speed !== 0) {
    const result = getState(metadata!);
    state = result.state;
    litCount = result.litCount;
    ay = metadata?.linearAccelerationMps2Y ?? 0;
    if (state !== "coast") {
      visible = true;
      lastVisibleRef.current = { state, litCount, ay };
    }
  }

  const display: DisplayState = visible
    ? { state, litCount, ay }
    : lastVisibleRef.current ?? { state: "accel", litCount: 0, ay: 0 };

  const isBrake = display.state === "brake";

  // Color-intensity: interpolate from grey → active color as litCount rises
  const colorT = display.litCount / N_ROWS; // 0.25 → 1.0
  const activeColor = isBrake ? BRAKE_COLOR : ACCEL_COLOR;
  const fillColor = lerpColor(GREY_COLOR, activeColor, colorT);

  // Lateral tilt: rotate around bottom-center, ±8° max
  const tiltDeg = Math.max(-8, Math.min(8, display.ay * 2.5));
  const tiltTransform = `rotate(${tiltDeg.toFixed(2)},${CX},${SVG_H})`;

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
        width="62%"
        overflow="visible"
        style={{ display: "block" }}
      >
        <g transform={tiltTransform}>
          <g transform={isBrake ? FLIP_TRANSFORM : undefined}>
            {/* 3D extrusion: shadow shifted down, peeks below main face */}
            {ROWS.map((r, i) => (
              <path
                key={`shadow-${i}`}
                d={SHADOW_PATHS[i]}
                fill={SHADOW_COLOR}
                fillOpacity={r.litIndex < display.litCount ? SHADOW_LIT_OPACITY : SHADOW_DIM_OPACITY}
              />
            ))}
            {/* Main colored face */}
            {ROWS.map((r, i) => (
              <path
                key={`fill-${i}`}
                d={ROW_PATHS[i]}
                fill={fillColor}
                fillOpacity={r.litIndex < display.litCount ? LIT_OPACITY : DIM_OPACITY}
              />
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}

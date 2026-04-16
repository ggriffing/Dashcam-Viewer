import { useEffect, useRef } from "react";
import type { SeiMetadataRaw } from "@/lib/dashcam/types";

interface FrontCameraOverlayProps {
  metadata: SeiMetadataRaw | null;
}

// ── Viewport & tile geometry ──────────────────────────────────────────────────
const SVG_W  = 520;
const CX     = SVG_W / 2;
const SVG_H  = 130;   // visible window height
const TILE_H = SVG_H; // one seamless tile = one viewport height

// Perspective-tapered rows: top = farthest/narrowest, bottom = closest/widest.
// hw:ch ≈ 10:1 simulates road-marking foreshortening.
const ROWS = [
  { hw: 75,  ch: 8,  thick: 4,  shadowDY: 3 },
  { hw: 110, ch: 11, thick: 6,  shadowDY: 4 },
  { hw: 160, ch: 16, thick: 8,  shadowDY: 6 },
  { hw: 220, ch: 22, thick: 10, shadowDY: 8 },
] as const;
const ROW_Y = [5, 25, 53, 92] as const;

function makeChevronPath(hw: number, ch: number, thick: number, y: number): string {
  const tipInner = Math.round(thick * ch / hw);
  return (
    `M${CX - hw},${y} L${CX},${y + ch} L${CX + hw},${y}` +
    ` L${CX + hw},${y + thick} L${CX},${y + ch - tipInner} L${CX - hw},${y + thick}Z`
  );
}

// Three copies of the pattern stacked vertically — the rAF loop scrolls through
// them and wraps modulo TILE_H so the seam is invisible.
const N_TILES = 3;
const TILED_MAIN: string[]   = [];
const TILED_SHADOW: string[] = [];
for (let tile = 0; tile < N_TILES; tile++) {
  const dy = tile * TILE_H;
  for (let i = 0; i < ROWS.length; i++) {
    const r = ROWS[i];
    const y = ROW_Y[i] + dy;
    TILED_MAIN.push(makeChevronPath(r.hw, r.ch, r.thick, y));
    TILED_SHADOW.push(makeChevronPath(r.hw, r.ch, r.thick, y + r.shadowDY));
  }
}

// ── Colors ────────────────────────────────────────────────────────────────────
const BRAKE_COLOR  = "#38BDF8"; // sky blue  — braking
const ACCEL_COLOR  = "#F59E0B"; // amber     — accelerating
const GREY_COLOR   = "#888888"; // neutral   — low intensity
const SHADOW_COLOR = "#0F2444"; // dark navy — 3-D depth

// Opacity ranges: scales with intensity (litCount/4)
const MAX_FILL_OP   = 0.92;
const MIN_FILL_OP   = 0.42;
const MAX_SHADOW_OP = 0.65;
const MIN_SHADOW_OP = 0.12;

// ── Animation constants ───────────────────────────────────────────────────────
// positive velocity = scroll downward (accel), negative = upward (braking)
const SCROLL_SCALE  = 22;  // SVG px/s per m/s² of longitudinal accel
const LATERAL_SCALE = 8;   // SVG px per m/s² of lateral accel
const LATERAL_MAX   = 28;  // max lateral offset in SVG px

// ── Helpers ───────────────────────────────────────────────────────────────────
function lerpColor(from: string, to: string, t: number): string {
  const p = (s: string, o: number) => parseInt(s.slice(o, o + 2), 16);
  const r = Math.round(p(from, 1) + (p(to, 1) - p(from, 1)) * t);
  const g = Math.round(p(from, 3) + (p(to, 3) - p(from, 3)) * t);
  const b = Math.round(p(from, 5) + (p(to, 5) - p(from, 5)) * t);
  return `rgb(${r},${g},${b})`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hasData(m: SeiMetadataRaw): boolean {
  return (
    m.linearAccelerationMps2X !== undefined ||
    m.acceleratorPedalPosition !== undefined ||
    m.brakeApplied !== undefined
  );
}

type DriveState = "accel" | "brake" | "coast";

function getState(m: SeiMetadataRaw): { state: DriveState; litCount: number; ax: number } {
  const rawAx = m.linearAccelerationMps2X;
  if (rawAx !== undefined) {
    const a   = Math.abs(rawAx);
    const lit = a < 1 ? 1 : a < 2 ? 2 : a < 4 ? 3 : 4;
    if (rawAx >  0.5) return { state: "accel", litCount: lit, ax: rawAx };
    if (rawAx < -0.5) return { state: "brake", litCount: lit, ax: rawAx };
    return { state: "coast", litCount: 0, ax: 0 };
  }
  if (m.brakeApplied) return { state: "brake", litCount: 3, ax: -3 };
  const pedal = m.acceleratorPedalPosition ?? 0;
  if (pedal > 0.05) {
    const lit = Math.max(1, Math.round(pedal * 4));
    return { state: "accel", litCount: lit, ax: lit };
  }
  return { state: "coast", litCount: 0, ax: 0 };
}

// ── Component ─────────────────────────────────────────────────────────────────
const OVERLAY_STYLE: React.CSSProperties = { paddingBottom: "8%" };

export function FrontCameraOverlay({ metadata }: FrontCameraOverlayProps) {
  // Refs written by React render, read by rAF loop — no React re-renders per frame
  const groupRef    = useRef<SVGGElement | null>(null);
  const scrollRef   = useRef(0);      // current scroll accumulator (SVG px)
  const velocityRef = useRef(0);      // px/s; positive = down (accel), neg = up (braking)
  const lateralRef  = useRef(0);      // horizontal offset in SVG px
  const rafRef      = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  // Animation loop: starts on mount, runs for the lifetime of the component.
  // Writes SVG transform directly — zero React overhead per frame.
  useEffect(() => {
    function frame(time: number) {
      if (lastTimeRef.current !== null) {
        const dt = Math.min((time - lastTimeRef.current) / 1000, 0.05); // cap at 50 ms
        scrollRef.current += velocityRef.current * dt;
      }
      lastTimeRef.current = time;

      if (groupRef.current) {
        // Keep offset in [0, TILE_H) and bias by -TILE_H so middle tile is visible
        const wrapped = ((scrollRef.current % TILE_H) + TILE_H) % TILE_H;
        const ty = -(TILE_H + wrapped);
        groupRef.current.setAttribute(
          "transform",
          `translate(${lateralRef.current.toFixed(1)},${ty.toFixed(1)})`,
        );
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ── Telemetry decode (runs each React render = each video frame) ──
  const noData = !metadata || !hasData(metadata);
  const speed  = metadata?.vehicleSpeedMps ?? -1;

  let visible  = false;
  let state: DriveState = "coast";
  let litCount = 0;
  let ax = 0;
  let ay = 0;

  if (!noData && speed !== 0) {
    const r = getState(metadata!);
    state    = r.state;
    litCount = r.litCount;
    ax       = r.ax;
    ay       = metadata?.linearAccelerationMps2Y ?? 0;
    if (state !== "coast") visible = true;
  }

  // Push new physics values to refs — rAF loop reads them next frame
  velocityRef.current = visible ? ax * SCROLL_SCALE : 0;
  lateralRef.current  = Math.max(-LATERAL_MAX, Math.min(LATERAL_MAX, ay * LATERAL_SCALE));

  // Visual properties — ok to update at video-frame rate via React render
  const colorT        = litCount / 4; // 0.25 → 1.0
  const activeColor   = state === "brake" ? BRAKE_COLOR : ACCEL_COLOR;
  const fillColor     = visible ? lerpColor(GREY_COLOR, activeColor, colorT) : GREY_COLOR;
  const fillOpacity   = lerp(MIN_FILL_OP,   MAX_FILL_OP,   colorT);
  const shadowOpacity = lerp(MIN_SHADOW_OP, MAX_SHADOW_OP, colorT);

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
        style={{ display: "block", overflow: "hidden" }}
      >
        <defs>
          <clipPath id="chev-clip">
            <rect x="0" y="0" width={SVG_W} height={SVG_H} />
          </clipPath>
        </defs>

        {/* Clip to viewport so tiles entering/exiting are hidden cleanly */}
        <g clipPath="url(#chev-clip)">
          {/* groupRef gets translate(lateralX, scrollY) written by rAF each frame */}
          <g ref={groupRef} transform={`translate(0,${-TILE_H})`}>
            {TILED_SHADOW.map((d, i) => (
              <path key={`s${i}`} d={d} fill={SHADOW_COLOR} fillOpacity={shadowOpacity} />
            ))}
            {TILED_MAIN.map((d, i) => (
              <path key={`m${i}`} d={d} fill={fillColor} fillOpacity={fillOpacity} />
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}

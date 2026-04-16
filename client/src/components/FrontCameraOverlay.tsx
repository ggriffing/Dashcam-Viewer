import { useEffect, useId, useRef } from "react";
import type { SeiMetadataRaw } from "@/lib/dashcam/types";

interface FrontCameraOverlayProps {
  metadata: SeiMetadataRaw | null;
  isPlaying: boolean;
}

const SVG_W  = 520;
const CX     = SVG_W / 2;
const SVG_H  = 150;
const TILE_H = SVG_H;

const HW    = 220;
const CH    = 4;
const THICK = 14;
const N_ROWS = 5;
const SHADOW_DY = 3;

const ROW_SPACING = 27;
const ROW_START   = 5;
const ROW_Y: number[] = [];
for (let i = 0; i < N_ROWS; i++) ROW_Y.push(ROW_START + i * ROW_SPACING);

function makeChevronDown(hw: number, ch: number, thick: number, y: number): string {
  const tipInner = Math.round(thick * ch / hw);
  return (
    `M${CX - hw},${y} L${CX},${y + ch} L${CX + hw},${y}` +
    ` L${CX + hw},${y + thick} L${CX},${y + ch + thick - tipInner} L${CX - hw},${y + thick}Z`
  );
}

function makeChevronUp(hw: number, ch: number, thick: number, y: number): string {
  const tipInner = Math.round(thick * ch / hw);
  return (
    `M${CX - hw},${y + ch + thick} L${CX},${y + thick} L${CX + hw},${y + ch + thick}` +
    ` L${CX + hw},${y + ch} L${CX},${y + tipInner} L${CX - hw},${y + ch}Z`
  );
}

const N_TILES = 3;

const TILED_DOWN_MAIN: string[]   = [];
const TILED_DOWN_SHADOW: string[] = [];
const TILED_UP_MAIN: string[]     = [];
const TILED_UP_SHADOW: string[]   = [];

for (let tile = 0; tile < N_TILES; tile++) {
  const dy = tile * TILE_H;
  for (let i = 0; i < N_ROWS; i++) {
    const y = ROW_Y[i] + dy;
    TILED_DOWN_MAIN.push(makeChevronDown(HW, CH, THICK, y));
    TILED_DOWN_SHADOW.push(makeChevronDown(HW, CH, THICK, y + SHADOW_DY));
    TILED_UP_MAIN.push(makeChevronUp(HW, CH, THICK, y));
    TILED_UP_SHADOW.push(makeChevronUp(HW, CH, THICK, y + SHADOW_DY));
  }
}

const BRAKE_COLOR  = "#38BDF8";
const ACCEL_COLOR  = "#F59E0B";
const GREY_COLOR   = "#888888";
const SHADOW_COLOR = "#0F2444";

const MAX_FILL_OP   = 0.85;
const MIN_FILL_OP   = 0.50;
const MAX_SHADOW_OP = 0.55;
const MIN_SHADOW_OP = 0.10;

const SCROLL_SCALE  = 28;
const LATERAL_SCALE = 8;
const LATERAL_MAX   = 28;

const AUTOPILOT_LABELS: Record<number, string> = {
  1: "Self-Driving",
  2: "Autosteer",
  3: "TACC",
};

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

export function FrontCameraOverlay({ metadata, isPlaying }: FrontCameraOverlayProps) {
  const uid = useId();
  const clipId = `chev-clip-${uid}`;

  const groupRef       = useRef<SVGGElement | null>(null);
  const scrollRef      = useRef(0);
  const velocityRef    = useRef(0);
  const targetVelRef   = useRef(0);
  const lateralRef     = useRef(0);
  const rafRef         = useRef<number | null>(null);
  const lastTimeRef    = useRef<number | null>(null);

  useEffect(() => {
    function frame(time: number) {
      if (lastTimeRef.current !== null) {
        const dt = Math.min((time - lastTimeRef.current) / 1000, 0.05);
        const decay = Math.min(1, dt * 5);
        velocityRef.current += (targetVelRef.current - velocityRef.current) * decay;
        scrollRef.current += velocityRef.current * dt;
      }
      lastTimeRef.current = time;

      if (groupRef.current) {
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

  targetVelRef.current = (visible && isPlaying) ? -ax * SCROLL_SCALE : 0;
  lateralRef.current   = Math.max(-LATERAL_MAX, Math.min(LATERAL_MAX, ay * LATERAL_SCALE));

  const colorT        = litCount / 4;
  const activeColor   = state === "brake" ? BRAKE_COLOR : ACCEL_COLOR;
  const fillColor     = visible ? lerpColor(GREY_COLOR, activeColor, colorT) : GREY_COLOR;
  const fillOpacity   = lerp(MIN_FILL_OP,   MAX_FILL_OP,   colorT);
  const shadowOpacity = lerp(MIN_SHADOW_OP, MAX_SHADOW_OP, colorT);

  const isAccel      = state === "accel";
  const mainPaths    = isAccel ? TILED_UP_MAIN   : TILED_DOWN_MAIN;
  const shadowPaths  = isAccel ? TILED_UP_SHADOW : TILED_DOWN_SHADOW;

  const autopilotState = metadata?.autopilotState ?? 0;
  const autopilotLabel = AUTOPILOT_LABELS[autopilotState];

  return (
    <div className="absolute inset-0 pointer-events-none">
      {autopilotLabel && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-sm border border-white/15" data-testid="autopilot-badge">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#38BDF8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <span className="text-[11px] font-medium text-sky-300 whitespace-nowrap tracking-wide">
            {autopilotLabel}
          </span>
        </div>
      )}

      <div
        className="absolute inset-x-0 bottom-0 flex justify-center"
        style={{
          paddingBottom: "4%",
          opacity: visible ? 1 : 0,
          transition: "opacity 120ms ease-out",
          perspective: "350px",
        }}
      >
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          width="62%"
          style={{
            display: "block",
            overflow: "hidden",
            transform: "rotateX(40deg)",
            transformOrigin: "center bottom",
          }}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x="0" y="0" width={SVG_W} height={SVG_H} />
            </clipPath>
          </defs>

          <g clipPath={`url(#${clipId})`}>
            <g ref={groupRef} transform={`translate(0,${-TILE_H})`}>
              {shadowPaths.map((d, i) => (
                <path key={`s${i}`} d={d} fill={SHADOW_COLOR} fillOpacity={shadowOpacity} />
              ))}
              {mainPaths.map((d, i) => (
                <path key={`m${i}`} d={d} fill={fillColor} fillOpacity={fillOpacity} />
              ))}
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}

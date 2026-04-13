import type { SeiMetadataRaw } from "@/lib/dashcam/types";

interface FrontCameraOverlayProps {
  metadata: SeiMetadataRaw | null;
}

const N_ROWS = 5;
const CHEV_H = 11;
const THICK = 4;
const GAP = 1;
const ROW_H = CHEV_H + THICK + GAP;
const SVG_W = 200;
const SVG_H = ROW_H * N_ROWS - GAP;
const CX = SVG_W / 2;
const LIT_OPACITY = 1;
const DIM_OPACITY = 0.15;
const BLUE = "#3B82F6";
const RENDER_W = 180;
const RENDER_H = Math.round(RENDER_W * SVG_H / SVG_W);

const LABEL_STYLE: { color: string; background: string } = {
  color: BLUE,
  background: "rgba(0,0,0,0.6)",
};

function halfWidth(row: number): number {
  return 100 - row * 20;
}

function makeUpPath(row: number): string {
  const hw = halfWidth(row);
  const yP = (N_ROWS - 1 - row) * ROW_H;
  return (
    `M${CX - hw},${yP + CHEV_H}` +
    ` L${CX},${yP}` +
    ` L${CX + hw},${yP + CHEV_H}` +
    ` L${CX + hw},${yP + CHEV_H + THICK}` +
    ` L${CX},${yP + THICK}` +
    ` L${CX - hw},${yP + CHEV_H + THICK}Z`
  );
}

const PATHS = Array.from({ length: N_ROWS }, (_, i) => makeUpPath(i));
const FLIP_TRANSFORM = `scale(1,-1) translate(0,${-SVG_H})`;

function accelToLit(ax: number): number {
  const a = Math.abs(ax);
  if (a < 1) return 1;
  if (a < 2) return 2;
  if (a < 4) return 3;
  if (a < 6) return 4;
  return 5;
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
  if (!metadata || !hasData(metadata)) return null;

  const speed = metadata.vehicleSpeedMps ?? -1;
  if (speed === 0) return null;

  const { state, litCount } = getState(metadata);
  const isBrake = state === "brake";

  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-none flex flex-col items-center gap-0.5">
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width={RENDER_W}
        height={RENDER_H}
        overflow="visible"
      >
        <rect
          x={4} y={4}
          width={SVG_W - 8} height={SVG_H - 8}
          rx={6}
          fill="black"
          fillOpacity={0.5}
        />

        <g transform={isBrake ? FLIP_TRANSFORM : undefined}>
          {PATHS.map((d, row) => (
            <path
              key={row}
              d={d}
              fill={BLUE}
              fillOpacity={row < litCount ? LIT_OPACITY : DIM_OPACITY}
            />
          ))}
        </g>
      </svg>

      {state !== "coast" && (
        <span
          className="text-[9px] font-mono tracking-widest px-2 py-px rounded"
          style={LABEL_STYLE}
        >
          {isBrake ? "BRAKE" : "ACCEL"}
        </span>
      )}
    </div>
  );
}

import type { SeiMetadataRaw } from "@/lib/dashcam/types";

interface FrontCameraOverlayProps {
  metadata: SeiMetadataRaw | null;
}

const N_ROWS = 5;
const CHEV_H = 9;
const THICK = 7;
const GAP = 4;
const ROW_H = CHEV_H + THICK + GAP;
const SVG_W = 200;
const SVG_H = ROW_H * N_ROWS - GAP;
const CX = SVG_W / 2;
const LIT_OPACITY = 1;
const DIM_OPACITY = 0.1;
const BLUE = "#3B82F6";

function halfWidth(row: number): number {
  return 96 - row * 18;
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

function getState(m: SeiMetadataRaw): { state: "accel" | "brake"; litCount: number } | null {
  const ax = m.linearAccelerationMps2X;
  if (ax !== undefined) {
    if (ax > 0.5) return { state: "accel", litCount: accelToLit(ax) };
    if (ax < -0.5) return { state: "brake", litCount: accelToLit(ax) };
    return null;
  }
  if (m.brakeApplied) return { state: "brake", litCount: 3 };
  const pedal = m.acceleratorPedalPosition ?? 0;
  if (pedal > 0.05) return { state: "accel", litCount: Math.max(1, Math.round(pedal * N_ROWS)) };
  return null;
}

export function FrontCameraOverlay({ metadata }: FrontCameraOverlayProps) {
  if (!metadata || !hasData(metadata)) return null;

  const result = getState(metadata);
  if (!result) return null;

  const { state, litCount } = result;
  const isBrake = state === "brake";
  const flipTransform = `scale(1,-1) translate(0,${-SVG_H})`;

  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-none flex flex-col items-center gap-0.5">
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width={150}
        height={Math.round(150 * SVG_H / SVG_W)}
        overflow="visible"
      >
        <rect
          x={4} y={4}
          width={SVG_W - 8} height={SVG_H - 8}
          rx={6}
          fill="black"
          fillOpacity={0.5}
        />

        <g transform={isBrake ? flipTransform : undefined}>
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

      <span
        className="text-[9px] font-mono tracking-widest px-2 py-px rounded"
        style={{ color: BLUE, background: "rgba(0,0,0,0.6)" }}
      >
        {isBrake ? "BRAKE" : "ACCEL"}
      </span>
    </div>
  );
}

import type { SeiMetadataRaw } from "@/lib/dashcam/types";

interface EnergyFlowIndicatorProps {
  metadata: SeiMetadataRaw | null;
}

const N = 5;
const CW = 13;
const CH = 22;
const GAP = 4;
const STEP = CW + GAP;
const CENTER_W = 48;
const TOTAL_W = N * STEP * 2 + CENTER_W;
const SVG_H = CH;
const LIT = "#3B82F6";
const DIM = "#1a3558";
const GLOW = "drop-shadow(0 0 5px #3B82F6aa)";

function chevronRightPath(): string {
  const notch = CW * 0.38;
  return `M0,0 L${CW},${CH / 2} L0,${CH} L${notch},${CH / 2} Z`;
}

function chevronLeftPath(): string {
  const notch = CW * 0.62;
  return `M${CW},0 L0,${CH / 2} L${CW},${CH} L${notch},${CH / 2} Z`;
}

const RIGHT_D = chevronRightPath();
const LEFT_D = chevronLeftPath();

function computeState(metadata: SeiMetadataRaw): {
  state: "accel" | "brake" | "coast";
  litCount: number;
} {
  const ax = metadata.linearAccelerationMps2X;

  if (ax !== undefined) {
    if (ax > 0.5) {
      return { state: "accel", litCount: Math.min(N, Math.ceil(ax / 1.5)) };
    }
    if (ax < -0.5) {
      return { state: "brake", litCount: Math.min(N, Math.ceil(Math.abs(ax) / 1.5)) };
    }
    return { state: "coast", litCount: 0 };
  }

  if (metadata.brakeApplied) {
    return { state: "brake", litCount: 3 };
  }
  const pedal = metadata.acceleratorPedalPosition ?? 0;
  if (pedal > 0.05) {
    return { state: "accel", litCount: Math.max(1, Math.round(pedal * N)) };
  }
  return { state: "coast", litCount: 0 };
}

export function EnergyFlowIndicator({ metadata }: EnergyFlowIndicatorProps) {
  if (!metadata) return null;

  const { state, litCount } = computeState(metadata);

  const brakeX = (i: number) => i * STEP;
  const accelX = (i: number) => N * STEP + CENTER_W + i * STEP;
  const centerX = N * STEP;

  const isAccel = state === "accel";
  const isBrake = state === "brake";
  const isCoast = state === "coast";

  const label = isAccel ? "ACCEL" : isBrake ? "BRAKE" : "COAST";

  return (
    <div
      className="flex-shrink-0 bg-black/90 border-t border-[#393C41] select-none flex flex-col items-center py-1.5 gap-1"
      data-testid="energy-flow-indicator"
    >
      <svg
        viewBox={`0 0 ${TOTAL_W} ${SVG_H}`}
        style={{ height: SVG_H, width: Math.min(340, TOTAL_W) }}
        overflow="visible"
      >
        {Array.from({ length: N }).map((_, i) => {
          const lit = isBrake && i >= N - litCount;
          return (
            <path
              key={`b${i}`}
              d={LEFT_D}
              transform={`translate(${brakeX(i)}, 0)`}
              fill={lit ? LIT : DIM}
              style={lit ? { filter: GLOW } : undefined}
            />
          );
        })}

        <rect
          x={centerX + 6}
          y={SVG_H / 2 - 3}
          width={CENTER_W - 12}
          height={6}
          rx={3}
          fill={isCoast ? LIT : DIM}
          style={isCoast ? { filter: GLOW } : undefined}
        />

        {Array.from({ length: N }).map((_, i) => {
          const lit = isAccel && i < litCount;
          return (
            <path
              key={`a${i}`}
              d={RIGHT_D}
              transform={`translate(${accelX(i)}, 0)`}
              fill={lit ? LIT : DIM}
              style={lit ? { filter: GLOW } : undefined}
            />
          );
        })}
      </svg>

      <span
        className="text-[9px] font-mono tracking-[0.2em]"
        style={{
          color: LIT,
          opacity: isCoast ? 0.45 : 1,
        }}
      >
        {label}
      </span>
    </div>
  );
}

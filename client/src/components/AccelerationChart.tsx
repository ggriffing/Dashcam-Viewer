import { useRef, useCallback, useMemo } from "react";
import type { VideoFrame } from "@/lib/dashcam/types";

interface AccelerationChartProps {
  frames: VideoFrame[];
  currentFrame: number;
  totalFrames: number;
  onSeek: (frame: number) => void;
}

const CHART_H = 80;
const VIEW_W = 1000;
const MAX_POINTS = 800;

const SERIES = [
  { key: "x" as const, label: "Accel X", color: "#3B82F6" },
  { key: "y" as const, label: "Accel Y", color: "#F59E0B" },
  { key: "z" as const, label: "Accel Z", color: "#06B6D4" },
];

function downsample(data: number[], maxPts: number): number[] {
  if (data.length <= maxPts) return data;
  const out: number[] = [];
  const step = (data.length - 1) / (maxPts - 1);
  for (let i = 0; i < maxPts; i++) {
    out.push(data[Math.round(i * step)]);
  }
  return out;
}

function buildLinePath(pts: number[], viewW: number, chartH: number, min: number, range: number): string {
  if (pts.length === 0) return "";
  const n = pts.length;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / Math.max(n - 1, 1)) * viewW;
    const y = chartH - ((pts[i] - min) / range) * chartH;
    parts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return parts.join(" ");
}

function buildAreaPath(pts: number[], viewW: number, chartH: number, min: number, range: number, zeroY: number): string {
  const line = buildLinePath(pts, viewW, chartH, min, range);
  if (!line) return "";
  const n = pts.length;
  const lastX = ((n - 1) / Math.max(n - 1, 1)) * viewW;
  return `${line} L${lastX.toFixed(1)},${zeroY.toFixed(1)} L0,${zeroY.toFixed(1)} Z`;
}

export function AccelerationChart({ frames, currentFrame, totalFrames, onSeek }: AccelerationChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const { xRaw, yRaw, zRaw, hasData, minVal, maxVal, zeroY, paths } = useMemo(() => {
    const xRaw = frames.map(f => f.sei?.linearAccelerationMps2X ?? 0);
    const yRaw = frames.map(f => f.sei?.linearAccelerationMps2Y ?? 0);
    const zRaw = frames.map(f => f.sei?.linearAccelerationMps2Z ?? 0);

    const anyReal =
      frames.some(f => f.sei?.linearAccelerationMps2X !== undefined) ||
      frames.some(f => f.sei?.linearAccelerationMps2Y !== undefined) ||
      frames.some(f => f.sei?.linearAccelerationMps2Z !== undefined);

    if (!anyReal) {
      return { xRaw, yRaw, zRaw, hasData: false, minVal: 0, maxVal: 0, zeroY: CHART_H / 2, paths: {} };
    }

    const allVals = [...xRaw, ...yRaw, ...zRaw];
    const absMax = Math.max(...allVals.map(Math.abs), 0.001);
    const bound = absMax * 1.12;
    const minVal = -bound;
    const maxVal = bound;
    const range = maxVal - minVal;
    const zeroY = CHART_H / 2;

    const xDs = downsample(xRaw, MAX_POINTS);
    const yDs = downsample(yRaw, MAX_POINTS);
    const zDs = downsample(zRaw, MAX_POINTS);

    const paths = {
      xLine: buildLinePath(xDs, VIEW_W, CHART_H, minVal, range),
      yLine: buildLinePath(yDs, VIEW_W, CHART_H, minVal, range),
      zLine: buildLinePath(zDs, VIEW_W, CHART_H, minVal, range),
      xArea: buildAreaPath(xDs, VIEW_W, CHART_H, minVal, range, zeroY),
      yArea: buildAreaPath(yDs, VIEW_W, CHART_H, minVal, range, zeroY),
      zArea: buildAreaPath(zDs, VIEW_W, CHART_H, minVal, range, zeroY),
    };

    return { xRaw, yRaw, zRaw, hasData: true, minVal, maxVal, zeroY, paths };
  }, [frames]);

  const handlePointerEvent = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onSeek(Math.round(frac * Math.max(totalFrames - 1, 0)));
    },
    [totalFrames, onSeek]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      handlePointerEvent(e);
    },
    [handlePointerEvent]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.buttons === 0) return;
      handlePointerEvent(e);
    },
    [handlePointerEvent]
  );

  if (!hasData) return null;

  const n = Math.max(frames.length, 1);
  const cursorX = (currentFrame / Math.max(n - 1, 1)) * VIEW_W;

  const sei = frames[currentFrame]?.sei;
  const fmtAxis = (raw: number | null | undefined): string =>
    raw !== undefined && raw !== null ? raw.toFixed(2) : "--";

  const labelX = Math.min(cursorX + 6, VIEW_W - 110);
  const bubbleVisible =
    sei?.linearAccelerationMps2X !== undefined ||
    sei?.linearAccelerationMps2Y !== undefined ||
    sei?.linearAccelerationMps2Z !== undefined;

  return (
    <div className="flex-shrink-0 bg-black/90 border-t border-[#393C41] select-none">
      <div className="flex items-center gap-4 px-3 pt-1.5">
        <span className="text-[10px] text-white/40 font-mono uppercase tracking-wide">
          m/s²
        </span>
        {SERIES.map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-[10px] font-mono" style={{ color }}>
              {label}
            </span>
          </div>
        ))}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${CHART_H}`}
        preserveAspectRatio="none"
        className="w-full cursor-crosshair block"
        style={{ height: CHART_H }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
        data-testid="chart-acceleration"
      >
        <line
          x1={0} y1={zeroY} x2={VIEW_W} y2={zeroY}
          stroke="white" strokeOpacity="0.12" strokeWidth="1"
        />

        <path d={paths.xArea} fill="#3B82F6" fillOpacity="0.18" />
        <path d={paths.yArea} fill="#F59E0B" fillOpacity="0.18" />
        <path d={paths.zArea} fill="#06B6D4" fillOpacity="0.18" />

        <path d={paths.xLine} fill="none" stroke="#3B82F6" strokeWidth="1.5" strokeLinejoin="round" />
        <path d={paths.yLine} fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinejoin="round" />
        <path d={paths.zLine} fill="none" stroke="#06B6D4" strokeWidth="1.5" strokeLinejoin="round" />

        <line
          x1={cursorX} y1={0} x2={cursorX} y2={CHART_H}
          stroke="white" strokeWidth="1.5" strokeOpacity="0.75"
        />

        {bubbleVisible && (
          <g transform={`translate(${labelX}, 6)`}>
            <text fontSize="9" fontFamily="monospace" fill="#3B82F6" y="0">
              X {fmtAxis(sei?.linearAccelerationMps2X)}
            </text>
            <text fontSize="9" fontFamily="monospace" fill="#F59E0B" y="12">
              Y {fmtAxis(sei?.linearAccelerationMps2Y)}
            </text>
            <text fontSize="9" fontFamily="monospace" fill="#06B6D4" y="24">
              Z {fmtAxis(sei?.linearAccelerationMps2Z)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

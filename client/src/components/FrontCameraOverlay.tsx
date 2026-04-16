import { useEffect, useRef } from "react";
import type { SeiMetadataRaw } from "@/lib/dashcam/types";

interface FrontCameraOverlayProps {
  metadata: SeiMetadataRaw | null;
  isPlaying: boolean;
}

const AUTOPILOT_LABELS: Record<number, string> = {
  1: "Self-Driving",
  2: "Autosteer",
  3: "TACC",
};

const BLUE = "#3B8EEA";

const CVS_W = 440;
const CVS_H = 200;
const CX = CVS_W / 2;

const TRAP_TOP_HW = 55;
const TRAP_BOT_HW = 200;
const TRAP_TOP_Y = 15;
const TRAP_BOT_Y = 190;
const TRAP_H = TRAP_BOT_Y - TRAP_TOP_Y;

const N_STRIPES = 7;
const GAP_RATIO = 0.40;
const SCROLL_SCALE = 40;
const LATERAL_SCALE = 0.05;
const LATERAL_MAX = 0.22;

function hasData(m: SeiMetadataRaw): boolean {
  return (
    m.linearAccelerationMps2X !== undefined ||
    m.acceleratorPedalPosition !== undefined ||
    m.brakeApplied !== undefined ||
    m.vehicleSpeedMps !== undefined
  );
}

type DriveState = "accel" | "brake" | "coast";

function getState(m: SeiMetadataRaw): { state: DriveState; ax: number } {
  const rawAx = m.linearAccelerationMps2X;
  if (rawAx !== undefined) {
    if (rawAx > 0.5) return { state: "accel", ax: rawAx };
    if (rawAx < -0.5) return { state: "brake", ax: rawAx };
    return { state: "coast", ax: 0 };
  }
  if (m.brakeApplied) return { state: "brake", ax: -3 };
  const pedal = m.acceleratorPedalPosition ?? 0;
  if (pedal > 0.05) return { state: "accel", ax: pedal * 4 };
  return { state: "coast", ax: 0 };
}

function hwAt(t: number): number {
  return TRAP_TOP_HW + (TRAP_BOT_HW - TRAP_TOP_HW) * t;
}

function shiftAt(t: number, lateral: number): number {
  return lateral * t;
}

function drawTrapezoid(ctx: CanvasRenderingContext2D, lateral: number) {
  const sTop = shiftAt(0, lateral);
  const sBot = shiftAt(1, lateral);
  ctx.beginPath();
  ctx.moveTo(CX - TRAP_BOT_HW + sBot, TRAP_BOT_Y);
  ctx.lineTo(CX - TRAP_TOP_HW + sTop, TRAP_TOP_Y);
  ctx.lineTo(CX + TRAP_TOP_HW + sTop, TRAP_TOP_Y);
  ctx.lineTo(CX + TRAP_BOT_HW + sBot, TRAP_BOT_Y);
  ctx.closePath();
}

function drawStripe(
  ctx: CanvasRenderingContext2D,
  y1: number,
  y2: number,
  lateral: number,
  chevronDip: number,
) {
  const clampY1 = Math.max(TRAP_TOP_Y, Math.min(TRAP_BOT_Y, y1));
  const clampY2 = Math.max(TRAP_TOP_Y, Math.min(TRAP_BOT_Y, y2));
  if (clampY2 - clampY1 < 0.5) return;

  const t1 = (clampY1 - TRAP_TOP_Y) / TRAP_H;
  const t2 = (clampY2 - TRAP_TOP_Y) / TRAP_H;
  const hw1 = hwAt(t1);
  const hw2 = hwAt(t2);
  const s1 = shiftAt(t1, lateral);
  const s2 = shiftAt(t2, lateral);

  ctx.beginPath();

  if (Math.abs(chevronDip) < 0.1) {
    ctx.moveTo(CX - hw1 + s1, clampY1);
    ctx.lineTo(CX + hw1 + s1, clampY1);
    ctx.lineTo(CX + hw2 + s2, clampY2);
    ctx.lineTo(CX - hw2 + s2, clampY2);
  } else {
    const midY = (clampY1 + clampY2) / 2 + chevronDip;
    const tMid = Math.max(0, Math.min(1, (midY - TRAP_TOP_Y) / TRAP_H));
    const hwM = hwAt(tMid);
    const sM = shiftAt(tMid, lateral);

    if (chevronDip > 0) {
      ctx.moveTo(CX - hw1 + s1, clampY1);
      ctx.lineTo(CX + hw1 + s1, clampY1);
      ctx.lineTo(CX + hwM + sM, midY);
      ctx.lineTo(CX + hw2 + s2, clampY2);
      ctx.lineTo(CX - hw2 + s2, clampY2);
      ctx.lineTo(CX - hwM + sM, midY);
    } else {
      ctx.moveTo(CX - hw1 + s1, clampY1);
      ctx.lineTo(CX - hwM + sM, midY);
      ctx.lineTo(CX + hw1 + s1, clampY1);
      ctx.lineTo(CX + hw2 + s2, clampY2);
      ctx.lineTo(CX + hwM + sM, midY);
      ctx.lineTo(CX - hw2 + s2, clampY2);
    }
  }

  ctx.closePath();
  ctx.fill();
}

export function FrontCameraOverlay({ metadata, isPlaying }: FrontCameraOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef(0);
  const velocityRef = useRef(0);
  const targetVelRef = useRef(0);
  const lateralRef = useRef(0);
  const stateRef = useRef<DriveState>("coast");
  const visibleRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const stripeH = TRAP_H / (N_STRIPES + (N_STRIPES - 1) * GAP_RATIO);
    const gapH = stripeH * GAP_RATIO;
    const period = stripeH + gapH;

    function frame(time: number) {
      if (lastTimeRef.current !== null) {
        const dt = Math.min((time - lastTimeRef.current) / 1000, 0.05);
        const decay = Math.min(1, dt * 5);
        velocityRef.current += (targetVelRef.current - velocityRef.current) * decay;
        scrollRef.current += velocityRef.current * dt;
      }
      lastTimeRef.current = time;

      const canvas = canvasRef.current;
      if (!canvas) { rafRef.current = requestAnimationFrame(frame); return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) { rafRef.current = requestAnimationFrame(frame); return; }

      ctx.clearRect(0, 0, CVS_W, CVS_H);

      if (visibleRef.current) {
        const lateral = lateralRef.current * (TRAP_BOT_HW * 2);
        const driveState = stateRef.current;

        if (driveState === "coast") {
          ctx.fillStyle = BLUE;
          ctx.globalAlpha = 0.40;
          drawTrapezoid(ctx, lateral);
          ctx.fill();

          ctx.globalAlpha = 0.55;
          const offset = ((scrollRef.current % period) + period) % period;
          for (let i = -1; i < N_STRIPES + 1; i++) {
            const y1 = TRAP_TOP_Y + i * period - offset;
            drawStripe(ctx, y1, y1 + stripeH, lateral, 0);
          }
        } else {
          const offset = ((scrollRef.current % period) + period) % period;
          const dipAmount = stripeH * 0.22;
          const dip = driveState === "accel" ? dipAmount : -dipAmount;

          ctx.fillStyle = BLUE;
          ctx.globalAlpha = 0.65;

          ctx.save();
          drawTrapezoid(ctx, lateral);
          ctx.clip();

          for (let i = -2; i < N_STRIPES + 2; i++) {
            const y1 = TRAP_TOP_Y + i * period - offset;
            drawStripe(ctx, y1, y1 + stripeH, lateral, dip);
          }
          ctx.restore();
        }
      }

      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const noData = !metadata || !hasData(metadata);
  const speed = metadata?.vehicleSpeedMps ?? 0;

  let visible = false;
  let state: DriveState = "coast";
  let ax = 0;
  let ay = 0;

  if (!noData && speed > 0.5) {
    const r = getState(metadata!);
    state = r.state;
    ax = r.ax;
    ay = metadata?.linearAccelerationMps2Y ?? 0;
    visible = true;
  }

  visibleRef.current = visible;
  stateRef.current = state;
  targetVelRef.current = (visible && isPlaying && state !== "coast") ? -ax * SCROLL_SCALE : 0;
  lateralRef.current = Math.max(-LATERAL_MAX, Math.min(LATERAL_MAX, ay * LATERAL_SCALE));

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

      <canvas
        ref={canvasRef}
        width={CVS_W}
        height={CVS_H}
        className="absolute bottom-[4%] left-1/2 -translate-x-1/2"
        style={{
          width: "55%",
          imageRendering: "auto",
          opacity: visible ? 1 : 0,
          transition: "opacity 150ms ease-out",
        }}
        data-testid="road-overlay-canvas"
      />
    </div>
  );
}

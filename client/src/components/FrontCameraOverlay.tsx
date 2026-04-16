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
const CVS_H = 220;
const CX = CVS_W / 2;

const BOT_Y = 210;
const BOT_HW = 200;
const TOP_HW_MIN = 160;
const TOP_HW_MAX = 50;

const MIN_H = 30;
const MAX_H = 180;
const SPEED_FOR_MAX = 30;

const N_STRIPES = 7;
const GAP_RATIO = 0.45;
const SCROLL_SCALE = 40;
const LATERAL_SCALE = 0.05;
const LATERAL_MAX = 0.22;

const ACCEL_THRESHOLD = 0.8;

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
    if (rawAx > ACCEL_THRESHOLD) return { state: "accel", ax: rawAx };
    if (rawAx < -ACCEL_THRESHOLD) return { state: "brake", ax: rawAx };
    return { state: "coast", ax: 0 };
  }
  if (m.brakeApplied) return { state: "brake", ax: -3 };
  const pedal = m.acceleratorPedalPosition ?? 0;
  if (pedal > 0.08) return { state: "accel", ax: pedal * 4 };
  return { state: "coast", ax: 0 };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

interface TrapGeom {
  topY: number;
  topHw: number;
  botY: number;
  botHw: number;
  h: number;
}

function computeTrapGeom(speed: number, ax: number): TrapGeom {
  const speedFrac = clamp01(speed / SPEED_FOR_MAX);
  const accelBoost = clamp01(Math.abs(ax) / 5) * 15;
  const h = MIN_H + (MAX_H - MIN_H) * speedFrac + accelBoost;
  const topY = BOT_Y - h;
  const hFrac = clamp01(h / MAX_H);
  const topHw = TOP_HW_MIN + (TOP_HW_MAX - TOP_HW_MIN) * hFrac;
  return { topY, topHw, botY: BOT_Y, botHw: BOT_HW, h };
}

function hwAt(g: TrapGeom, t: number): number {
  return g.topHw + (g.botHw - g.topHw) * t;
}

function sAt(t: number, lateral: number): number {
  return lateral * t;
}

function drawTrap(ctx: CanvasRenderingContext2D, g: TrapGeom, lateral: number) {
  const sTop = sAt(0, lateral);
  const sBot = sAt(1, lateral);
  ctx.beginPath();
  ctx.moveTo(CX - g.botHw + sBot, g.botY);
  ctx.lineTo(CX - g.topHw + sTop, g.topY);
  ctx.lineTo(CX + g.topHw + sTop, g.topY);
  ctx.lineTo(CX + g.botHw + sBot, g.botY);
  ctx.closePath();
}

function drawChevronStripe(
  ctx: CanvasRenderingContext2D,
  g: TrapGeom,
  y1raw: number,
  y2raw: number,
  lateral: number,
  dipDir: number,
) {
  const y1 = Math.max(g.topY, Math.min(g.botY, y1raw));
  const y2 = Math.max(g.topY, Math.min(g.botY, y2raw));
  if (y2 - y1 < 0.5) return;

  const t1 = (y1 - g.topY) / g.h;
  const t2 = (y2 - g.topY) / g.h;
  const hw1 = hwAt(g, t1);
  const hw2 = hwAt(g, t2);
  const s1 = sAt(t1, lateral);
  const s2 = sAt(t2, lateral);

  ctx.beginPath();

  if (Math.abs(dipDir) < 0.01) {
    ctx.moveTo(CX - hw1 + s1, y1);
    ctx.lineTo(CX + hw1 + s1, y1);
    ctx.lineTo(CX + hw2 + s2, y2);
    ctx.lineTo(CX - hw2 + s2, y2);
  } else {
    const dip = (y2 - y1) * 0.28 * dipDir;
    const midY = (y1 + y2) / 2 + dip;
    const tMid = clamp01((midY - g.topY) / g.h);
    const hwM = hwAt(g, tMid);
    const sM = sAt(tMid, lateral);

    if (dipDir > 0) {
      ctx.moveTo(CX - hw1 + s1, y1);
      ctx.lineTo(CX + hw1 + s1, y1);
      ctx.lineTo(CX + hwM + sM, midY);
      ctx.lineTo(CX + hw2 + s2, y2);
      ctx.lineTo(CX - hw2 + s2, y2);
      ctx.lineTo(CX - hwM + sM, midY);
    } else {
      ctx.moveTo(CX - hw1 + s1, y1);
      ctx.lineTo(CX - hwM + sM, midY);
      ctx.lineTo(CX + hw1 + s1, y1);
      ctx.lineTo(CX + hw2 + s2, y2);
      ctx.lineTo(CX + hwM + sM, midY);
      ctx.lineTo(CX - hw2 + s2, y2);
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
  const geomRef = useRef<TrapGeom>(computeTrapGeom(0, 0));
  const visibleRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  useEffect(() => {
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
        const lateral = lateralRef.current * (BOT_HW * 2);
        const driveState = stateRef.current;
        const g = geomRef.current;

        const stripeH = g.h / (N_STRIPES + (N_STRIPES - 1) * GAP_RATIO);
        const gapH = stripeH * GAP_RATIO;
        const period = stripeH + gapH;

        if (driveState === "coast") {
          ctx.fillStyle = BLUE;
          ctx.globalAlpha = 0.50;
          drawTrap(ctx, g, lateral);
          ctx.fill();
        } else {
          const offset = ((scrollRef.current % period) + period) % period;
          const dipDir = driveState === "brake" ? -1 : 1;

          ctx.fillStyle = BLUE;
          ctx.globalAlpha = 0.60;

          ctx.save();
          drawTrap(ctx, g, lateral);
          ctx.clip();

          for (let i = -2; i < N_STRIPES + 3; i++) {
            const y1 = g.topY + i * period - offset;
            drawChevronStripe(ctx, g, y1, y1 + stripeH, lateral, dipDir);
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

  if (!noData) {
    const r = getState(metadata!);
    state = r.state;
    ax = r.ax;
    ay = metadata?.linearAccelerationMps2Y ?? 0;
    visible = true;
  }

  visibleRef.current = visible;
  stateRef.current = state;
  geomRef.current = computeTrapGeom(speed, ax);
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
        className="absolute bottom-[2%] left-1/2 -translate-x-1/2"
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

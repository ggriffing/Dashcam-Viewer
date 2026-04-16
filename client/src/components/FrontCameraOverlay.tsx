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

const BOT_Y = 198;
const BOT_HW = 195;
const TOP_HW_MIN = 155;
const TOP_HW_MAX = 45;

const MIN_H = 28;
const MAX_H = 170;
const SPEED_FOR_MAX = 30;

const N_ARROWS = 5;
const ARROW_FILL_RATIO = 0.70;
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
  const accelBoost = clamp01(Math.abs(ax) / 5) * 12;
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

function drawChevron(
  ctx: CanvasRenderingContext2D,
  g: TrapGeom,
  apexYraw: number,
  arrowH: number,
  lateral: number,
  pointUp: boolean,
) {
  const apexY = pointUp ? apexYraw : apexYraw + arrowH;
  const wingY = pointUp ? apexYraw + arrowH : apexYraw;

  const cApex = Math.max(g.topY, Math.min(g.botY, apexY));
  const cWing = Math.max(g.topY, Math.min(g.botY, wingY));
  if (Math.abs(cApex - cWing) < 1) return;

  const tApex = (cApex - g.topY) / g.h;
  const tWing = (cWing - g.topY) / g.h;
  const hwWing = hwAt(g, tWing);
  const sApex = sAt(tApex, lateral);
  const sWing = sAt(tWing, lateral);

  // Arm thickness: 55% of arrowH in Y, 42% of wing half-width in X
  const armY = arrowH * 0.55;
  const armX = hwWing * 0.42;

  const innerApexYraw = pointUp ? apexY + armY : apexY - armY;
  const cInnerApex = Math.max(g.topY, Math.min(g.botY, innerApexYraw));
  const tInnerApex = (cInnerApex - g.topY) / g.h;
  const sInnerApex = sAt(tInnerApex, lateral);
  const hwInnerWing = Math.max(0, hwWing - armX);

  ctx.beginPath();
  // Outer triangle — clockwise
  ctx.moveTo(CX + sApex, cApex);
  ctx.lineTo(CX + hwWing + sWing, cWing);
  ctx.lineTo(CX - hwWing + sWing, cWing);
  ctx.closePath();
  // Inner triangle — counter-clockwise → creates hollow center via evenodd
  ctx.moveTo(CX + sInnerApex, cInnerApex);
  ctx.lineTo(CX - hwInnerWing + sWing, cWing);
  ctx.lineTo(CX + hwInnerWing + sWing, cWing);
  ctx.closePath();
  ctx.fill("evenodd");
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
  const speedMphRef = useRef(0);
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

        ctx.save();
        drawTrap(ctx, g, lateral);
        ctx.clip();

        if (driveState === "coast") {
          ctx.fillStyle = BLUE;
          ctx.globalAlpha = 0.50;
          ctx.fill();
        } else {
          const slotH = g.h / N_ARROWS;
          const arrowH = slotH * ARROW_FILL_RATIO;
          const period = slotH;
          const offset = ((scrollRef.current % period) + period) % period;
          const pointUp = driveState === "accel";

          // Semi-transparent blue base — road shows through in gaps between arrows
          ctx.fillStyle = BLUE;
          ctx.globalAlpha = 0.35;
          ctx.fillRect(0, 0, CVS_W, CVS_H);

          // Solid opaque bright-blue chevrons on top
          ctx.fillStyle = BLUE;
          ctx.globalAlpha = 1.0;
          for (let i = -2; i < N_ARROWS + 3; i++) {
            const slotTop = g.topY + i * period - offset;
            const arrowTop = slotTop + (slotH - arrowH) / 2;
            drawChevron(ctx, g, arrowTop, arrowH, lateral, pointUp);
          }
        }

        ctx.restore();

        // Speed text inside the trapezoid near the bottom
        const g2 = geomRef.current;
        const mph = speedMphRef.current;
        const textY = g2.botY - 14;
        ctx.globalAlpha = 1.0;
        ctx.font = "bold 44px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillText(String(mph), CX + 2, textY + 2);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(String(mph), CX, textY);
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
  speedMphRef.current = Math.round(speed * 2.23694);
  targetVelRef.current = (visible && isPlaying && state !== "coast") ? ax * SCROLL_SCALE : 0;
  lateralRef.current = Math.max(-LATERAL_MAX, Math.min(LATERAL_MAX, ay * LATERAL_SCALE));

  const autopilotState = metadata?.autopilotState ?? 0;
  const autopilotLabel = AUTOPILOT_LABELS[autopilotState];

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
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
        className="absolute bottom-0 left-1/2 -translate-x-1/2"
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

import { 
  Gauge, 
  Navigation, 
  Car, 
  CircleDot, 
  Zap,
  ArrowUpCircle,
  ArrowLeftCircle,
  ArrowRightCircle
} from "lucide-react";
import type { SeiMetadataRaw } from "@/lib/dashcam/types";

interface TelemetryHUDProps {
  metadata: SeiMetadataRaw | null;
  frameNumber: number;
  totalFrames: number;
  currentTime: number;
  duration: number;
  filename?: string;
}

const GEAR_LABELS: Record<number, string> = {
  0: "P",
  1: "D",
  2: "R",
  3: "N",
};

const AUTOPILOT_LABELS: Record<number, string> = {
  0: "OFF",
  1: "FSD",
  2: "AUTOSTEER",
  3: "TACC",
};

function formatSpeed(mps: number | undefined): string {
  if (mps === undefined || mps === null) return "--";
  const mph = mps * 2.237;
  return Math.round(mph).toString();
}

function formatHeading(deg: number | undefined): string {
  if (deg === undefined || deg === null) return "--";
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(deg / 45) % 8;
  return `${Math.round(deg)}° ${directions[index]}`;
}

function formatSteeringAngle(deg: number | undefined): string {
  if (deg === undefined || deg === null) return "--";
  const direction = deg > 0 ? "R" : deg < 0 ? "L" : "";
  return `${Math.abs(deg).toFixed(1)}° ${direction}`;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatAccelerator(pos: number | undefined): string {
  if (pos === undefined || pos === null) return "--";
  return `${Math.round(pos * 100)}%`;
}

export function TelemetryHUD({
  metadata,
  frameNumber,
  totalFrames,
  currentTime,
  duration,
  filename,
}: TelemetryHUDProps) {
  const gear = metadata?.gearState !== undefined ? GEAR_LABELS[metadata.gearState] || "--" : "--";
  const autopilot = metadata?.autopilotState !== undefined ? AUTOPILOT_LABELS[metadata.autopilotState] || "OFF" : "OFF";
  const isAutopilotActive = metadata?.autopilotState !== undefined && metadata.autopilotState > 0;

  return (
    <div className="w-full bg-black/90 border-t border-[#393C41] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-[#00FF00]" />
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-2xl font-bold text-[#00FF00] tabular-nums" data-testid="text-speed">
                {formatSpeed(metadata?.vehicleSpeedMps)}
              </span>
              <span className="text-xs text-[#00FF00]/70">MPH</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Car className="w-4 h-4 text-[#00FF00]" />
            <span 
              className="font-mono text-lg font-semibold text-[#00FF00] w-6 text-center"
              data-testid="text-gear"
            >
              {gear}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded ${isAutopilotActive ? 'bg-blue-600/30 border border-blue-500/50' : 'bg-transparent'}`}>
              <Zap className={`w-4 h-4 ${isAutopilotActive ? 'text-blue-400' : 'text-[#00FF00]/50'}`} />
              <span 
                className={`font-mono text-sm ${isAutopilotActive ? 'text-blue-400' : 'text-[#00FF00]/50'}`}
                data-testid="text-autopilot"
              >
                {autopilot}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Navigation className="w-4 h-4 text-[#00FF00]" />
            <span className="font-mono text-sm text-[#00FF00]" data-testid="text-heading">
              {formatHeading(metadata?.headingDeg)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <ArrowUpCircle className="w-4 h-4 text-[#00FF00]" />
            <span className="font-mono text-sm text-[#00FF00]" data-testid="text-steering">
              {formatSteeringAngle(metadata?.steeringWheelAngle)}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <ArrowLeftCircle 
                className={`w-4 h-4 transition-colors ${metadata?.blinkerOnLeft ? 'text-yellow-400' : 'text-[#00FF00]/30'}`} 
              />
              <span className={`font-mono text-xs ${metadata?.blinkerOnLeft ? 'text-yellow-400' : 'text-[#00FF00]/30'}`}>
                L
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className={`font-mono text-xs ${metadata?.blinkerOnRight ? 'text-yellow-400' : 'text-[#00FF00]/30'}`}>
                R
              </span>
              <ArrowRightCircle 
                className={`w-4 h-4 transition-colors ${metadata?.blinkerOnRight ? 'text-yellow-400' : 'text-[#00FF00]/30'}`} 
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <CircleDot 
              className={`w-4 h-4 transition-colors ${metadata?.brakeApplied ? 'text-red-500' : 'text-[#00FF00]/30'}`} 
            />
            <span 
              className={`font-mono text-sm ${metadata?.brakeApplied ? 'text-red-500' : 'text-[#00FF00]/30'}`}
              data-testid="text-brake"
            >
              BRAKE
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-[#00FF00]/70">ACCEL</span>
            <span className="font-mono text-sm text-[#00FF00]" data-testid="text-accelerator">
              {formatAccelerator(metadata?.acceleratorPedalPosition)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex flex-col items-end">
            <span className="font-mono text-sm text-[#00FF00]" data-testid="text-time">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            <span className="font-mono text-xs text-[#00FF00]/70" data-testid="text-frame">
              Frame {frameNumber + 1} / {totalFrames}
            </span>
          </div>

          {filename && (
            <div className="max-w-[200px] truncate">
              <span className="font-mono text-xs text-[#00FF00]/50" data-testid="text-filename">
                {filename}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

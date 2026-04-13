import { useState, useCallback, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Film, Download } from "lucide-react";
import type { CameraAngle, VideoFrame as DashcamVideoFrame, VideoConfig, SeiMetadataRaw } from "@/lib/dashcam/types";
import { fetchStaticMapImage, latLngToMapPixel, type StaticMapInfo } from "@/lib/dashcam/staticMapOverlay";

const TESLA_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 36" width="28" height="36">
  <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22S28 23.333 28 14C28 6.268 21.732 0 14 0z" fill="#E82127"/>
  <path d="M7 10h14v2H15v8h-2v-8H7z" fill="white"/>
  <path d="M9 10c0 0 1 1.5 5 1.5S19 10 19 10" stroke="white" stroke-width="1.5" fill="none"/>
</svg>`;
const TESLA_MARKER_URL = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(TESLA_MARKER_SVG)}`;

const MAP_W = 240;
const MAP_H = 180;
const MAP_MARGIN = 8;
const MARKER_W = 18;
const MARKER_H = 23;

interface CameraData {
  angle: CameraAngle;
  file: File | null;
  frames: DashcamVideoFrame[];
  config: VideoConfig | null;
  isActive: boolean;
}

interface VideoExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cameras: CameraData[];
  frameDurations: number[];
  primaryFilename: string;
}

type LayoutMode = "single" | "dual-horizontal" | "triple-horizontal" | "quad";

const GEAR_LABELS: Record<number, string> = { 0: "P", 1: "D", 2: "R", 3: "N" };
const AUTOPILOT_LABELS: Record<number, string> = { 0: "OFF", 1: "FSD", 2: "AUTOSTEER", 3: "TACC" };
const CAMERA_GRID_POSITIONS: Record<CameraAngle, { row: number; col: number }> = {
  front: { row: 0, col: 0 }, right: { row: 0, col: 1 },
  left: { row: 1, col: 0 }, rear: { row: 1, col: 1 },
};

function formatSpeed(mps: number | undefined): string {
  if (mps === undefined || mps === null) return "--";
  return Math.round(mps * 2.237).toString();
}
function formatHeading(deg: number | undefined): string {
  if (deg === undefined || deg === null) return "--";
  const normalized = ((deg % 360) + 360) % 360;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return `${Math.round(normalized)}° ${dirs[Math.round(normalized / 45) % 8]}`;
}
function formatSteeringAngle(deg: number | undefined): string {
  if (deg === undefined || deg === null) return "--";
  const dir = deg > 0 ? "R" : deg < 0 ? "L" : "";
  return `${Math.abs(deg).toFixed(1)}° ${dir}`;
}
function formatCoordinate(deg: number | undefined, isLat: boolean): string {
  if (deg === undefined || deg === null) return "--";
  const dir = isLat ? (deg >= 0 ? "N" : "S") : (deg >= 0 ? "E" : "W");
  return `${Math.abs(deg).toFixed(4)}° ${dir}`;
}
function formatAccelerator(pos: number | undefined): string {
  if (pos === undefined || pos === null) return "--";
  return `${Math.round(pos * 100)}%`;
}
function formatTime(frameIndex: number, durations: number[]): string {
  let totalMs = 0;
  for (let i = 0; i < frameIndex && i < durations.length; i++) totalMs += durations[i];
  const secs = totalMs / 1000;
  return `${Math.floor(secs / 60)}:${Math.floor(secs % 60).toString().padStart(2, "0")}`;
}

function drawMapOverlay(
  ctx: CanvasRenderingContext2D,
  mapInfo: StaticMapInfo,
  markerImg: HTMLImageElement,
  lat: number,
  lng: number,
  canvasWidth: number,
  hudTop: number,
) {
  const x = canvasWidth - MAP_W - MAP_MARGIN;
  const y = hudTop - MAP_H - MAP_MARGIN;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, MAP_W, MAP_H);
  ctx.clip();
  ctx.drawImage(mapInfo.image, x, y, MAP_W, MAP_H);

  const pixel = latLngToMapPixel(lat, lng, mapInfo.centerLat, mapInfo.centerLng, mapInfo.zoom, mapInfo.pixelWidth, mapInfo.pixelHeight);
  const markerX = x + pixel.x * (MAP_W / mapInfo.pixelWidth);
  const markerY = y + pixel.y * (MAP_H / mapInfo.pixelHeight);
  ctx.drawImage(markerImg, markerX - MARKER_W / 2, markerY - MARKER_H, MARKER_W, MARKER_H);
  ctx.restore();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, MAP_W, MAP_H);
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function VideoExportDialog({
  open,
  onOpenChange,
  cameras,
  frameDurations,
  primaryFilename,
}: VideoExportDialogProps) {
  const [selectedCameras, setSelectedCameras] = useState<Record<CameraAngle, boolean>>({
    front: true, left: false, right: false, rear: false,
  });
  const [includeMap, setIncludeMap] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const abortRef = useRef(false);

  const frontCamera = cameras.find(c => c.angle === "front" && c.isActive);
  const availableCameras = cameras.filter(c => c.isActive && c.angle !== "front");

  const { data: mapAvailable } = useQuery<{ available: boolean }>({
    queryKey: ["/api/map-available"],
    staleTime: Infinity,
  });
  const hasMapsApiKey = mapAvailable?.available ?? false;

  const hasGpsData = useMemo(() => {
    if (!frontCamera) return false;
    return frontCamera.frames.some(f => f.sei && (f.sei.latitudeDeg !== 0 || f.sei.longitudeDeg !== 0));
  }, [frontCamera]);

  const canShowMapOption = hasGpsData && hasMapsApiKey;

  const handleCameraToggle = useCallback((angle: CameraAngle, checked: boolean) => {
    if (angle === "front") return;
    setSelectedCameras(prev => ({ ...prev, [angle]: checked }));
  }, []);

  const getLayoutMode = useCallback((): LayoutMode => {
    const selected = Object.entries(selectedCameras)
      .filter(([angle, checked]) => checked && cameras.find(c => c.angle === angle)?.isActive)
      .map(([angle]) => angle as CameraAngle);
    if (selected.length === 1) return "single";
    if (selected.length === 2) return "dual-horizontal";
    if (selected.length === 3) return "triple-horizontal";
    return "quad";
  }, [selectedCameras, cameras]);

  const getSelectedCameras = useCallback((): CameraData[] => {
    return Object.entries(selectedCameras)
      .filter(([, checked]) => checked)
      .map(([angle]) => cameras.find(c => c.angle === angle))
      .filter((c): c is CameraData => c !== undefined && c.isActive);
  }, [selectedCameras, cameras]);

  const drawTelemetryHUD = useCallback((
    ctx: CanvasRenderingContext2D,
    width: number,
    hudHeight: number,
    yOffset: number,
    metadata: SeiMetadataRaw | null,
    frameIndex: number,
    totalFrames: number,
    _filename: string,
  ) => {
    ctx.fillStyle = "rgba(0, 0, 0, 0.9)";
    ctx.fillRect(0, yOffset, width, hudHeight);
    ctx.strokeStyle = "#393C41";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, yOffset);
    ctx.lineTo(width, yOffset);
    ctx.stroke();

    const hudColor = "#00FF00";
    const hudColorDim = "rgba(0, 255, 0, 0.5)";
    const fontSize = Math.max(28, Math.floor(hudHeight * 0.35));
    const smallFontSize = Math.max(20, Math.floor(hudHeight * 0.2));

    ctx.font = `bold ${fontSize}px "SF Mono", Consolas, monospace`;
    ctx.textBaseline = "middle";

    let x = 40;
    const centerY = yOffset + hudHeight / 2;

    ctx.fillStyle = hudColor;
    const speed = formatSpeed(metadata?.vehicleSpeedMps);
    ctx.fillText(speed, x, centerY);
    const speedWidth = ctx.measureText(speed).width;

    ctx.font = `${smallFontSize}px "SF Mono", Consolas, monospace`;
    ctx.fillStyle = hudColorDim;
    ctx.fillText(" MPH", x + speedWidth, centerY);
    x += speedWidth + 80;

    ctx.font = `bold ${fontSize}px "SF Mono", Consolas, monospace`;
    ctx.fillStyle = hudColor;
    const gear = metadata?.gearState !== undefined ? GEAR_LABELS[metadata.gearState] || "--" : "--";
    ctx.fillText(gear, x, centerY);
    x += ctx.measureText(gear).width + 15;

    const autopilot = metadata?.autopilotState !== undefined ? AUTOPILOT_LABELS[metadata.autopilotState] || "OFF" : "OFF";
    const isAutopilotActive = metadata?.autopilotState !== undefined && metadata.autopilotState > 0;
    ctx.font = `${smallFontSize}px "SF Mono", Consolas, monospace`;
    ctx.fillStyle = isAutopilotActive ? "#60A5FA" : hudColorDim;
    ctx.fillText(autopilot, x, centerY);
    x += ctx.measureText(autopilot).width + 15;

    ctx.fillStyle = hudColor;
    const headingText = formatHeading(metadata?.headingDeg);
    ctx.fillText(headingText, x, centerY);
    x += ctx.measureText(headingText).width + 10;

    const steeringText = formatSteeringAngle(metadata?.steeringWheelAngle);
    ctx.fillText(steeringText, x, centerY);
    x += ctx.measureText(steeringText).width + 10;

    ctx.fillStyle = metadata?.brakeApplied ? "#EF4444" : hudColorDim;
    ctx.fillText("BRK", x, centerY);
    x += ctx.measureText("BRK").width + 5;

    ctx.fillStyle = metadata?.blinkerOnLeft ? "#FBBF24" : hudColorDim;
    ctx.fillText("L", x, centerY);
    x += ctx.measureText("L").width + 5;

    ctx.fillStyle = metadata?.blinkerOnRight ? "#FBBF24" : hudColorDim;
    ctx.fillText("R", x, centerY);
    x += ctx.measureText("R").width + 10;

    ctx.fillStyle = hudColor;
    const accelText = `ACCEL ${formatAccelerator(metadata?.acceleratorPedalPosition)}`;
    ctx.fillText(accelText, x, centerY);

    ctx.textAlign = "right";
    ctx.fillStyle = hudColor;
    ctx.fillText(`${formatTime(frameIndex, frameDurations)} | ${frameIndex + 1}/${totalFrames}`, width - 20, centerY);
    ctx.textAlign = "left";
  }, [frameDurations]);

  const decodeAllFrames = useCallback(async (
    frames: DashcamVideoFrame[],
    config: VideoConfig,
  ): Promise<(VideoFrame | null)[]> => {
    const results: (VideoFrame | null)[] = new Array(frames.length).fill(null);
    const DashcamMP4Class = (window as any).DashcamMP4;
    const sc = new Uint8Array([0, 0, 0, 1]);

    return new Promise((resolve) => {
      let outputIndex = 0;
      const decoder = new VideoDecoder({
        output: (videoFrame: VideoFrame) => { results[outputIndex++] = videoFrame; },
        error: (e) => { console.error("Decoder error:", e); },
      });

      try {
        decoder.configure({ codec: config.codec, codedWidth: config.width, codedHeight: config.height });

        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i];
          const data = frame.keyframe
            ? DashcamMP4Class.concat(sc, frame.sps || config.sps, sc, frame.pps || config.pps, sc, frame.data)
            : DashcamMP4Class.concat(sc, frame.data);
          decoder.decode(new EncodedVideoChunk({ type: frame.keyframe ? "key" : "delta", timestamp: i * 33333, data }));
        }

        decoder.flush().then(() => { decoder.close(); resolve(results); })
          .catch(() => { decoder.close(); resolve(results); });
      } catch (e) {
        console.error("Failed to decode frames:", e);
        resolve(results);
      }
    });
  }, []);

  const handleExport = useCallback(async () => {
    if (!frontCamera) return;

    abortRef.current = false;
    setIsExporting(true);
    setProgress(0);
    setStatusText("Initializing...");

    try {
      const selected = getSelectedCameras();
      const layoutMode = getLayoutMode();
      const totalFrames = Math.max(...selected.map(c => c.frames.length));
      const sourceConfig = frontCamera.config!;
      const sourceWidth = sourceConfig.width;
      const sourceHeight = sourceConfig.height;

      if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") {
        setStatusText("Video export requires WebCodecs API (not supported in Safari)");
        setIsExporting(false);
        return;
      }

      const hudHeight = 120;
      let outputWidth: number;
      let outputHeight: number;

      switch (layoutMode) {
        case "single": outputWidth = sourceWidth; outputHeight = sourceHeight + hudHeight; break;
        case "dual-horizontal": outputWidth = sourceWidth * 2; outputHeight = sourceHeight + hudHeight; break;
        case "triple-horizontal": outputWidth = sourceWidth * 3; outputHeight = sourceHeight + hudHeight; break;
        default: outputWidth = sourceWidth * 2; outputHeight = sourceHeight * 2 + hudHeight; break;
      }

      outputWidth = Math.floor(outputWidth / 2) * 2;
      outputHeight = Math.floor(outputHeight / 2) * 2;

      let scale = 1;
      if (outputWidth > 1920 || outputHeight > 1080) {
        scale = Math.min(1920 / outputWidth, 1080 / outputHeight);
        outputWidth = Math.floor((outputWidth * scale) / 2) * 2;
        outputHeight = Math.floor((outputHeight * scale) / 2) * 2;
      }

      const codecProfiles = ["avc1.640028", "avc1.64001f", "avc1.42e01f", "avc1.42001f"];
      let encoderConfig: VideoEncoderConfig | null = null;
      for (const codec of codecProfiles) {
        const config = { codec, width: outputWidth, height: outputHeight, bitrate: 6_000_000, framerate: 30 };
        const support = await VideoEncoder.isConfigSupported(config);
        if (support.supported) { encoderConfig = config; break; }
      }

      if (!encoderConfig) {
        setStatusText("Video encoding not supported for this resolution");
        setIsExporting(false);
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext("2d")!;

      const target = new ArrayBufferTarget();
      const muxer = new Muxer({ target, video: { codec: "avc", width: outputWidth, height: outputHeight }, fastStart: "in-memory" });

      let encoderError: Error | null = null;
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => { console.error("Encoder error:", e); encoderError = e; },
      });
      encoder.configure(encoderConfig);

      // Fetch map image once before the encode loop (if GPS + user opted in)
      let staticMapInfo: StaticMapInfo | null = null;
      let markerImg: HTMLImageElement | null = null;

      if (canShowMapOption && includeMap) {
        setStatusText("Fetching map image...");
        const gpsPath = frontCamera.frames
          .map(f => f.sei)
          .filter((s): s is NonNullable<typeof s> => s !== null && s !== undefined)
          .filter(s => s.latitudeDeg !== undefined && s.longitudeDeg !== undefined &&
                       (s.latitudeDeg !== 0 || s.longitudeDeg !== 0))
          .map(s => ({ lat: s.latitudeDeg!, lng: s.longitudeDeg! }));

        if (gpsPath.length > 0) {
          [staticMapInfo, markerImg] = await Promise.all([
            fetchStaticMapImage(gpsPath, MAP_W, MAP_H),
            loadImage(TESLA_MARKER_URL),
          ]);
        }
      }

      setStatusText("Decoding video frames...");
      const decodedCameras: Map<CameraAngle, (VideoFrame | null)[]> = new Map();
      for (const camera of selected) {
        if (camera.config) {
          decodedCameras.set(camera.angle, await decodeAllFrames(camera.frames, camera.config));
        }
      }

      setStatusText("Encoding video...");
      let timestamp = 0;
      const scaledSourceWidth = Math.floor(sourceWidth * scale);
      const scaledSourceHeight = Math.floor(sourceHeight * scale);
      const scaledHudHeight = Math.floor(hudHeight * scale);

      for (let i = 0; i < totalFrames; i++) {
        if (abortRef.current || encoderError) break;

        ctx.fillStyle = "#181818";
        ctx.fillRect(0, 0, outputWidth, outputHeight);

        for (const camera of selected) {
          const decodedFrame = decodedCameras.get(camera.angle)?.[i];
          if (decodedFrame) {
            let dx = 0, dy = 0;
            if (layoutMode === "dual-horizontal") {
              dx = camera.angle === "front" ? scaledSourceWidth : 0;
            } else if (layoutMode === "triple-horizontal") {
              const orderedAngles: CameraAngle[] = ["left", "front", "right", "rear"];
              const sortedAngles = selected.map((c: CameraData) => c.angle).sort(
                (a: CameraAngle, b: CameraAngle) => orderedAngles.indexOf(a) - orderedAngles.indexOf(b),
              );
              dx = sortedAngles.indexOf(camera.angle) * scaledSourceWidth;
            } else if (layoutMode === "quad") {
              const pos = CAMERA_GRID_POSITIONS[camera.angle];
              dx = pos.col * scaledSourceWidth;
              dy = pos.row * scaledSourceHeight;
            }
            ctx.drawImage(decodedFrame, dx, dy, scaledSourceWidth, scaledSourceHeight);
            decodedFrame.close();
          }
        }

        const metadata = frontCamera.frames[i]?.sei || null;
        const hudY = outputHeight - scaledHudHeight;
        drawTelemetryHUD(ctx, outputWidth, scaledHudHeight, hudY, metadata, i, totalFrames, primaryFilename);

        if (staticMapInfo && markerImg) {
          const lat = metadata?.latitudeDeg;
          const lng = metadata?.longitudeDeg;
          if (lat !== undefined && lng !== undefined && (lat !== 0 || lng !== 0)) {
            drawMapOverlay(ctx, staticMapInfo, markerImg, lat, lng, outputWidth, hudY);
          }
        }

        const frameDuration = frameDurations[i] || 33.33;
        const videoFrame = new VideoFrame(canvas, { timestamp: timestamp * 1000, duration: frameDuration * 1000 });
        encoder.encode(videoFrame, { keyFrame: i % 30 === 0 });
        videoFrame.close();
        timestamp += frameDuration;
        setProgress(Math.round((i / totalFrames) * 100));

        while (encoder.encodeQueueSize > 5) await new Promise(r => setTimeout(r, 10));
      }

      if (encoderError) throw encoderError;

      setStatusText("Finalizing...");
      await encoder.flush();
      encoder.close();
      muxer.finalize();

      const blob = new Blob([target.buffer], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const baseName = primaryFilename ? primaryFilename.replace(/\.mp4$/i, "") : "dashcam_export";
      a.download = `${baseName}_merged.mp4`;
      a.click();
      URL.revokeObjectURL(url);

      setStatusText("Export complete!");
      setTimeout(() => {
        onOpenChange(false);
        setIsExporting(false);
        setProgress(0);
        setStatusText("");
      }, 1500);
    } catch (e) {
      console.error("Export failed:", e);
      setStatusText(`Export failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      setIsExporting(false);
    }
  }, [
    frontCamera, getSelectedCameras, getLayoutMode, frameDurations,
    drawTelemetryHUD, decodeAllFrames, primaryFilename, onOpenChange,
    canShowMapOption, includeMap,
  ]);

  const handleCancel = useCallback(() => {
    if (isExporting) { abortRef.current = true; }
    else { onOpenChange(false); }
  }, [isExporting, onOpenChange]);

  const selectedCount = Object.values(selectedCameras).filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[#181818] border-[#393C41]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Film className="w-5 h-5 text-[#E82127]" />
            Export Video with Telemetry
          </DialogTitle>
          <DialogDescription className="text-white/60">
            Merge selected camera angles into a single video with SEI telemetry overlay.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div className="space-y-3">
            <div className="flex items-center space-x-3 opacity-70">
              <Checkbox id="camera-front" checked={true} disabled data-testid="checkbox-camera-front" />
              <Label htmlFor="camera-front" className="text-white">Front Camera (Required)</Label>
              {!frontCamera && <span className="text-xs text-red-400">Not loaded</span>}
            </div>

            {availableCameras.map(camera => (
              <div key={camera.angle} className="flex items-center space-x-3">
                <Checkbox
                  id={`camera-${camera.angle}`}
                  checked={selectedCameras[camera.angle]}
                  onCheckedChange={(checked) => handleCameraToggle(camera.angle, checked === true)}
                  disabled={isExporting}
                  data-testid={`checkbox-camera-${camera.angle}`}
                />
                <Label htmlFor={`camera-${camera.angle}`} className="text-white capitalize">
                  {camera.angle} Camera
                </Label>
              </div>
            ))}
          </div>

          {canShowMapOption && (
            <div className="border-t border-[#393C41] pt-3">
              <div className="flex items-center space-x-3">
                <Checkbox
                  id="include-map"
                  checked={includeMap}
                  onCheckedChange={(checked) => setIncludeMap(checked === true)}
                  disabled={isExporting}
                  data-testid="checkbox-include-map"
                />
                <Label htmlFor="include-map" className="text-white">Include map overlay</Label>
              </div>
              {includeMap && (
                <p className="mt-1 ml-7 text-xs text-white/40">
                  Animated route mini-map in the bottom-right corner
                </p>
              )}
            </div>
          )}

          <div className="text-xs text-white/50 space-y-1">
            <p>Layout: {getLayoutMode() === "single" ? "Single view" :
                       getLayoutMode() === "dual-horizontal" ? "Side by side (Other | Front)" :
                       getLayoutMode() === "triple-horizontal" ? "3-wide horizontal row" : "2x2 Grid"}</p>
          </div>

          {isExporting && (
            <div className="space-y-2">
              <Progress value={progress} className="h-2" />
              <p className="text-sm text-white/60 text-center">{statusText} ({progress}%)</p>
            </div>
          )}

          {!frontCamera && (
            <p className="text-sm text-red-400">
              Front camera is required for video export. Please load front camera footage first.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={handleCancel}
            disabled={isExporting && progress > 90}
            data-testid="button-cancel-export"
          >
            {isExporting ? "Cancel" : "Close"}
          </Button>
          <Button
            variant="default"
            onClick={handleExport}
            disabled={!frontCamera || isExporting}
            data-testid="button-start-export"
          >
            <Download className="w-4 h-4 mr-2" />
            {isExporting ? "Exporting..." : `Export ${selectedCount} Camera${selectedCount > 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

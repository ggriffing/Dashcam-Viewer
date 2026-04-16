import { useEffect, useRef, forwardRef, useImperativeHandle, useState, useCallback } from "react";
import type { CameraAngle, VideoFrame, VideoConfig, DashcamMP4, SeiMetadataRaw } from "@/lib/dashcam/types";
import { FrontCameraOverlay } from "./FrontCameraOverlay";

interface VideoPlayerProps {
  angle: CameraAngle;
  frames: VideoFrame[];
  config: VideoConfig | null;
  currentFrame: number;
  isActive: boolean;
  overlayMetadata?: SeiMetadataRaw | null;
  isPlaying?: boolean;
}

export interface VideoPlayerHandle {
  renderFrame: (frameIndex: number) => Promise<void>;
  getCanvas: () => HTMLCanvasElement | null;
}

const ANGLE_LABELS: Record<CameraAngle, string> = {
  front: "FRONT",
  left: "LEFT",
  right: "RIGHT",
  rear: "REAR",
};

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({ angle, frames, config, currentFrame, isActive, overlayMetadata, isPlaying = false }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const decoderRef = useRef<VideoDecoder | null>(null);
    const decodingRef = useRef(false);
    const pendingFrameRef = useRef<number | null>(null);

    const renderFrame = useCallback(async (frameIndex: number) => {
      if (!frames.length || !config || !canvasRef.current) return;
      
      const ctx = canvasRef.current.getContext("2d");
      if (!ctx) return;

      if (decodingRef.current) {
        pendingFrameRef.current = frameIndex;
        return;
      }

      decodingRef.current = true;

      try {
        let keyIdx = frameIndex;
        while (keyIdx >= 0 && !frames[keyIdx].keyframe) keyIdx--;
        if (keyIdx < 0) {
          showError(ctx, config, "No preceding keyframe");
          decodingRef.current = false;
          return;
        }

        if (decoderRef.current) {
          try {
            decoderRef.current.close();
          } catch {}
        }

        let count = 0;
        const target = frameIndex - keyIdx + 1;

        await new Promise<void>((resolve, reject) => {
          decoderRef.current = new VideoDecoder({
            output: (frame) => {
              count++;
              if (count === target) {
                ctx.drawImage(frame, 0, 0, ctx.canvas.width, ctx.canvas.height);
              }
              frame.close();
              if (count >= target) resolve();
            },
            error: reject,
          });

          decoderRef.current.configure({
            codec: config.codec,
            width: config.width,
            height: config.height,
          });

          const DashcamMP4Class = window.DashcamMP4;
          for (let i = keyIdx; i <= frameIndex; i++) {
            const frame = frames[i];
            const sc = new Uint8Array([0, 0, 0, 1]);
            const data = frame.keyframe
              ? DashcamMP4Class.concat(
                  sc,
                  frame.sps || config.sps,
                  sc,
                  frame.pps || config.pps,
                  sc,
                  frame.data
                )
              : DashcamMP4Class.concat(sc, frame.data);

            const chunk = new EncodedVideoChunk({
              type: frame.keyframe ? "key" : "delta",
              timestamp: frame.index * 33333,
              data,
            });
            decoderRef.current.decode(chunk);
          }

          decoderRef.current.flush().catch(reject);
        });
      } catch (err: any) {
        if (!err.message?.includes("Aborted")) {
          const ctx = canvasRef.current?.getContext("2d");
          if (ctx && config) {
            showError(ctx, config, "Decode failed");
          }
        }
      } finally {
        decodingRef.current = false;
        if (pendingFrameRef.current !== null) {
          const next = pendingFrameRef.current;
          pendingFrameRef.current = null;
          renderFrame(next);
        }
      }
    }, [frames, config]);

    useImperativeHandle(ref, () => ({
      renderFrame,
      getCanvas: () => canvasRef.current,
    }));

    useEffect(() => {
      if (config && canvasRef.current) {
        canvasRef.current.width = config.width;
        canvasRef.current.height = config.height;
      }
    }, [config]);

    useEffect(() => {
      if (isActive && frames.length > 0) {
        renderFrame(currentFrame);
      }
    }, [currentFrame, isActive, frames.length, renderFrame]);

    useEffect(() => {
      return () => {
        if (decoderRef.current) {
          try {
            decoderRef.current.close();
          } catch {}
        }
      };
    }, []);

    return (
      <div 
        className="relative w-full h-full bg-black"
        style={{ clipPath: 'inset(0)', overflow: 'hidden', contain: 'paint' }}
        data-testid={`video-player-${angle}`}
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full object-contain"
        />
        <div className="absolute top-2 left-2 px-2 py-1 bg-black/70 rounded text-xs font-mono text-[#00FF00]">
          {ANGLE_LABELS[angle]}
        </div>
        {angle === "front" && isActive && (
          <FrontCameraOverlay metadata={overlayMetadata ?? null} isPlaying={isPlaying} />
        )}
        {!isActive && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <span className="text-muted-foreground text-sm">No video loaded</span>
          </div>
        )}
      </div>
    );
  }
);

function showError(ctx: CanvasRenderingContext2D, config: VideoConfig, msg: string) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, config.width, config.height);
  ctx.fillStyle = "#888";
  ctx.font = "bold 24px Roboto, system-ui";
  ctx.textAlign = "center";
  ctx.fillText(msg, config.width / 2, config.height / 2);
}

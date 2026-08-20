import { useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from "react";
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
    const currentFrameRef = useRef(currentFrame);
    currentFrameRef.current = currentFrame;
    const targetFrameRef = useRef(0);
    const renderFrameRef = useRef<(frameIndex: number) => Promise<void>>(async () => {});

    // Track decoder state for reuse across frames (key stabilization change).
    // We keep one decoder alive per VideoPlayer while the clip data is valid.
    // We only recreate when we must (backward seek across GOP boundary, new load, error).
    const decoderLastKeyframeRef = useRef<number>(-1);
    const decoderLastFrameRef = useRef<number>(-1);

    // Highest logical frame index we've painted for this player.
    // Used to drop late-arriving outputs from previous decode requests
    // (prevents jitter / jumping backward after the "latest wins" painting change).
    const lastPaintedFrameRef = useRef<number>(-1);

    const destroyDecoder = useCallback(() => {
      if (decoderRef.current) {
        try {
          decoderRef.current.close();
        } catch {}
        decoderRef.current = null;
      }
      decoderLastKeyframeRef.current = -1;
      decoderLastFrameRef.current = -1;
      // Note: we intentionally do *not* reset lastPaintedFrameRef here.
      // Resetting it on every intra-clip GOP transition was allowing late outputs
      // from the previous decoder (just before close) to paint older frames
      // after we started the new GOP. We only reset on a full new clip load.
    }, []);

    const handleDecoderOutput = useCallback((videoFrame: VideoFrame) => {
      try {
        const logicalIndex = Math.round(videoFrame.timestamp / 33333);
        const target = targetFrameRef.current;
        // Only paint the requested frame (or one behind, for decoder delay).
        // Never redraw the same index — a later empty EOS output with the same
        // timestamp was overwriting the picture (flash, then blank canvas).
        const canvas = canvasRef.current;
        const outputCtx = canvas?.getContext("2d");
        if (
          outputCtx &&
          logicalIndex <= target &&
          logicalIndex >= target - 1 &&
          logicalIndex > lastPaintedFrameRef.current
        ) {
          outputCtx.drawImage(videoFrame, 0, 0, outputCtx.canvas.width, outputCtx.canvas.height);
          lastPaintedFrameRef.current = logicalIndex;
        }
      } finally {
        videoFrame.close();
      }
    }, []);

    const renderFrame = useCallback(async (frameIndex: number) => {
      if (!frames.length || !config || !canvasRef.current) return;

      const ctx = canvasRef.current.getContext("2d");
      if (!ctx) return;

      targetFrameRef.current = frameIndex;

      // If we're seeking backward (or to a much earlier frame), reset the
      // painted-frame guard so older frames are allowed to draw again.
      // Without this, dragging the scrubber to the far left would appear
      // to freeze on the first frame (the guard would reject all outputs
      // whose logical index is < the previously painted high number).
      if (frameIndex < lastPaintedFrameRef.current) {
        lastPaintedFrameRef.current = -1;
      }

      // Serialization guard for rapid renderFrame calls.
      // After the Phase 1 decoder reuse work, overlapping decodes on the same
      // player are rare. This guard now mainly protects against pathological
      // cases (very rapid seeking + loading). If a decode is in flight we
      // remember only the most recent requested frame and process it after
      // the current one finishes.
      if (decodingRef.current) {
        pendingFrameRef.current = frameIndex;
        return;
      }

      let keyIdx = frameIndex;
      while (keyIdx >= 0 && !frames[keyIdx].keyframe) keyIdx--;
      if (keyIdx < 0) {
        showError(ctx, config, "No preceding keyframe");
        return;
      }

      // Already showing this frame from the current GOP — skip a full re-decode.
      if (
        decoderRef.current != null &&
        decoderRef.current.state === "configured" &&
        decoderLastKeyframeRef.current === keyIdx &&
        decoderLastFrameRef.current === frameIndex
      ) {
        return;
      }

      decodingRef.current = true;

      try {
        // Keep one VideoDecoder alive per camera for the lifetime of the clip.
        // Recreate only when we must (new GOP, backward seek, new clip, or error).
        // On reuse, feed only frames after the last decoded index — not the whole GOP.
        // Never flush() between frames: on VideoToolbox (macOS) flush is treated as
        // end-of-stream, so the next delta is garbage or forces a GOP replay.
        const canReuse =
          decoderRef.current != null &&
          decoderRef.current.state === "configured" &&
          decoderLastKeyframeRef.current === keyIdx &&
          decoderLastFrameRef.current >= keyIdx &&
          decoderLastFrameRef.current < frameIndex;

        if (!canReuse) {
          destroyDecoder();
        }

        const startIdx = canReuse ? decoderLastFrameRef.current + 1 : keyIdx;

        if (!canReuse) {
          decoderRef.current = new VideoDecoder({
            output: handleDecoderOutput,
            error: () => {
              destroyDecoder();
            },
          });

          decoderRef.current.configure({
            codec: config.codec,
            codedWidth: config.width,
            codedHeight: config.height,
          });
        }

        const DashcamMP4Class = window.DashcamMP4;
        for (let i = startIdx; i <= frameIndex; i++) {
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
          decoderRef.current!.decode(chunk);
        }

        decoderLastKeyframeRef.current = keyIdx;
        decoderLastFrameRef.current = frameIndex;

        // VideoToolbox often will not emit the first picture until flush().
        // Wait one frame for async output; if this feed produced nothing, flush
        // to drain, then close the decoder (flush is EOS — do not feed P-frames
        // into it). The canvas keeps the pixels.
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        if (
          decoderRef.current?.state === "configured" &&
          lastPaintedFrameRef.current < startIdx
        ) {
          try {
            await decoderRef.current.flush();
          } catch {
            // aborted if the decoder was closed
          }
          destroyDecoder();
        }
      } catch (err: any) {
        if (!err.message?.includes("Aborted")) {
          const errCtx = canvasRef.current?.getContext("2d");
          if (errCtx && config) {
            showError(errCtx, config, "Decode failed");
          }
        }
        // On any error we destroy the decoder so the next attempt starts fresh.
        destroyDecoder();
      } finally {
        decodingRef.current = false;

        // If a newer frame request arrived while we were decoding, process it now.
        // This keeps the "latest wins" behavior even under rapid input.
        if (pendingFrameRef.current !== null) {
          const next = pendingFrameRef.current;
          pendingFrameRef.current = null;
          renderFrame(next);
        }
      }
    }, [frames, config, destroyDecoder, handleDecoderOutput]);

    renderFrameRef.current = renderFrame;

    useImperativeHandle(ref, () => ({
      renderFrame,
      getCanvas: () => canvasRef.current,
    }));

    // Size the canvas and paint the first frame when a clip is loaded.
    // Playback and seeking call renderFrame imperatively.
    // Canvas resize must happen in this same effect, before decode — assigning
    // canvas.width clears the bitmap, which is what made the first frame flash
    // then disappear when it ran after a successful paint.
    useEffect(() => {
      if (config && canvasRef.current) {
        canvasRef.current.width = config.width;
        canvasRef.current.height = config.height;
      }
      destroyDecoder();
      lastPaintedFrameRef.current = -1;
      pendingFrameRef.current = null;
      if (isActive && frames.length > 0) {
        void renderFrameRef.current(currentFrameRef.current);
      }
    }, [frames, config, isActive, destroyDecoder]);

    // Final safety net on unmount.
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
  ctx.fillStyle = "#ff6b6b";
  ctx.font = "bold 18px Roboto, system-ui";
  ctx.textAlign = "center";
  ctx.fillText(msg, config.width / 2, config.height / 2 - 10);
  ctx.fillStyle = "#888";
  ctx.font = "14px Roboto, system-ui";
  ctx.fillText("Check console for details", config.width / 2, config.height / 2 + 18);
}

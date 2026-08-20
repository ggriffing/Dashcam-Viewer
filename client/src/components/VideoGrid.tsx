import { useRef, useCallback, forwardRef, useImperativeHandle, useEffect, useState } from "react";
import { VideoPlayer, type VideoPlayerHandle } from "./VideoPlayer";
import type { CameraAngle, VideoFrame, VideoConfig, SeiMetadataRaw } from "@/lib/dashcam/types";

interface CameraData {
  angle: CameraAngle;
  frames: VideoFrame[];
  config: VideoConfig | null;
  isActive: boolean;
}

interface VideoGridProps {
  cameras: CameraData[];
  currentFrame: number;
  frontMetadata?: SeiMetadataRaw | null;
  isPlaying?: boolean;
}

export interface VideoGridHandle {
  renderAllFrames: (frameIndex: number) => Promise<void>;
}

interface ContainerSize {
  width: number;
  height: number;
}

export function getFittedSingleCameraSize(
  containerWidth: number,
  containerHeight: number,
  aspectRatio: number,
): ContainerSize | null {
  if (
    !Number.isFinite(containerWidth) ||
    !Number.isFinite(containerHeight) ||
    !Number.isFinite(aspectRatio) ||
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    aspectRatio <= 0
  ) {
    return null;
  }

  const width = Math.min(containerWidth, containerHeight * aspectRatio);
  return { width, height: width / aspectRatio };
}

function useContainerSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<ContainerSize | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updateSize = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize((previous) =>
        previous?.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };

    updateSize();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateSize);
    observer?.observe(element);
    window.addEventListener("resize", updateSize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  return { ref, size };
}

function CameraCell({
  camera,
  currentFrame,
  overlayMetadata,
  playerRef,
  isPlaying,
}: {
  camera: CameraData;
  currentFrame: number;
  overlayMetadata?: SeiMetadataRaw | null;
  playerRef: (handle: VideoPlayerHandle | null) => void;
  isPlaying?: boolean;
}) {
  const ar = camera.config
    ? `${camera.config.width} / ${camera.config.height}`
    : '4 / 3';

  return (
    <div style={{
      aspectRatio: ar,
      position: 'relative',
      width: '100%',
      clipPath: 'inset(0)',
    }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <VideoPlayer
          ref={playerRef}
          angle={camera.angle}
          frames={camera.frames}
          config={camera.config}
          currentFrame={currentFrame}
          isActive={camera.isActive}
          overlayMetadata={overlayMetadata}
          isPlaying={isPlaying}
        />
      </div>
    </div>
  );
}

export const VideoGrid = forwardRef<VideoGridHandle, VideoGridProps>(
  function VideoGrid({ cameras, currentFrame, frontMetadata, isPlaying }, ref) {
    const playerRefs = useRef<Map<CameraAngle, VideoPlayerHandle>>(new Map());
    const { ref: viewportRef, size: viewportSize } = useContainerSize();

    const renderAllFrames = useCallback(async (frameIndex: number) => {
      const promises: Promise<void>[] = [];
      playerRefs.current.forEach((player, angle) => {
        const camera = cameras.find(c => c.angle === angle);
        if (camera?.isActive && player) {
          // Per-player try/catch so one camera's decode failure does not
          // reject the whole batch and break the other camera angles.
          promises.push(
            player.renderFrame(frameIndex).catch((err) => {
              console.warn(`[VideoGrid] renderFrame failed for ${angle}:`, err);
            })
          );
        }
      });
      await Promise.all(promises);
    }, [cameras]);

    useImperativeHandle(ref, () => ({ renderAllFrames }));

    const setPlayerRef = useCallback((angle: CameraAngle) => (handle: VideoPlayerHandle | null) => {
      if (handle) playerRefs.current.set(angle, handle);
      else playerRefs.current.delete(angle);
    }, []);

    const topRowAngles: CameraAngle[] = ["left", "front", "right"];
    const rearCamera = cameras.find(c => c.angle === "rear" && c.isActive);

    const activeTopRowCameras = topRowAngles
      .map(angle => cameras.find(c => c.angle === angle))
      .filter((camera): camera is CameraData => camera?.isActive ?? false);

    const columns = Math.max(activeTopRowCameras.length, rearCamera ? 1 : 0, 1);
    const singleFrontCamera = activeTopRowCameras.length === 1
      && activeTopRowCameras[0].angle === "front"
      && !rearCamera;
    const singleCameraAspectRatio = singleFrontCamera && activeTopRowCameras[0].config
      ? activeTopRowCameras[0].config.width / activeTopRowCameras[0].config.height
      : 4 / 3;
    const fittedSingleCameraSize = singleFrontCamera && viewportSize
      ? getFittedSingleCameraSize(
          viewportSize.width,
          viewportSize.height,
          singleCameraAspectRatio,
        )
      : null;

    if (singleFrontCamera) {
      const frontCamera = activeTopRowCameras[0];

      return (
        <div
          ref={viewportRef}
          className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden"
          data-testid="video-grid"
        >
          <div
            style={{
              width: fittedSingleCameraSize?.width ?? "100%",
              maxWidth: "100%",
              flex: "0 0 auto",
            }}
          >
            <CameraCell
              key={frontCamera.angle}
              camera={frontCamera}
              currentFrame={currentFrame}
              overlayMetadata={frontMetadata}
              playerRef={setPlayerRef(frontCamera.angle)}
              isPlaying={isPlaying}
            />
          </div>
        </div>
      );
    }

    return (
      <div
        className="w-full"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: 0,
        }}
        data-testid="video-grid"
      >
        {activeTopRowCameras.map((camera) => (
          <CameraCell
            key={camera.angle}
            camera={camera}
            currentFrame={currentFrame}
            overlayMetadata={camera.angle === "front" ? frontMetadata : undefined}
            playerRef={setPlayerRef(camera.angle)}
            isPlaying={isPlaying}
          />
        ))}

        {rearCamera && columns === 3 && (
          <>
            <div />
            <CameraCell
              key="rear"
              camera={rearCamera}
              currentFrame={currentFrame}
              playerRef={setPlayerRef("rear")}
            />
            <div />
          </>
        )}
        {rearCamera && columns !== 3 && (
          <CameraCell
            key="rear"
            camera={rearCamera}
            currentFrame={currentFrame}
            playerRef={setPlayerRef("rear")}
          />
        )}
      </div>
    );
  }
);

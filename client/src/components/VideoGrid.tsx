import { useRef, useCallback, forwardRef, useImperativeHandle } from "react";
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
}

export interface VideoGridHandle {
  renderAllFrames: (frameIndex: number) => Promise<void>;
}

function CameraCell({
  camera,
  currentFrame,
  overlayMetadata,
  playerRef,
}: {
  camera: CameraData;
  currentFrame: number;
  overlayMetadata?: SeiMetadataRaw | null;
  playerRef: (handle: VideoPlayerHandle | null) => void;
}) {
  return (
    <div style={{ aspectRatio: '4/3', position: 'relative', width: '100%' }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <VideoPlayer
          ref={playerRef}
          angle={camera.angle}
          frames={camera.frames}
          config={camera.config}
          currentFrame={currentFrame}
          isActive={camera.isActive}
          overlayMetadata={overlayMetadata}
        />
      </div>
    </div>
  );
}

export const VideoGrid = forwardRef<VideoGridHandle, VideoGridProps>(
  function VideoGrid({ cameras, currentFrame, frontMetadata }, ref) {
    const playerRefs = useRef<Map<CameraAngle, VideoPlayerHandle>>(new Map());

    const renderAllFrames = useCallback(async (frameIndex: number) => {
      const promises: Promise<void>[] = [];
      playerRefs.current.forEach((player, angle) => {
        const camera = cameras.find(c => c.angle === angle);
        if (camera?.isActive && player) {
          promises.push(player.renderFrame(frameIndex));
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
    const rearCamera = cameras.find(c => c.angle === "rear");
    const hasRear = rearCamera?.isActive;

    const activeTopRowCameras = topRowAngles
      .map(angle => cameras.find(c => c.angle === angle))
      .filter((camera): camera is CameraData => camera?.isActive ?? false);

    return (
      <div
        className="w-full"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          alignItems: 'start',
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
          />
        ))}

        {hasRear && (
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
      </div>
    );
  }
);

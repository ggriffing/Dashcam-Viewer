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

    useImperativeHandle(ref, () => ({
      renderAllFrames,
    }));

    const setPlayerRef = useCallback((angle: CameraAngle) => (handle: VideoPlayerHandle | null) => {
      if (handle) {
        playerRefs.current.set(angle, handle);
      } else {
        playerRefs.current.delete(angle);
      }
    }, []);

    const topRowAngles: CameraAngle[] = ["left", "front", "right"];
    const rearCamera = cameras.find(c => c.angle === "rear");
    const hasRear = rearCamera?.isActive;

    const activeTopRowCameras = topRowAngles
      .map(angle => cameras.find(c => c.angle === angle))
      .filter((camera): camera is CameraData => camera?.isActive ?? false);

    return (
      <div 
        className={`w-full flex flex-col bg-black ${hasRear ? 'h-full' : ''}`}
        data-testid="video-grid"
      >
        <div className={`flex ${hasRear ? 'flex-1 min-h-0' : 'w-full'}`}>
          {activeTopRowCameras.map((camera) => (
            <div
              key={camera.angle}
              className="flex-1 min-w-0 relative"
              style={{ aspectRatio: hasRear ? undefined : '4/3' }}
            >
              <VideoPlayer
                ref={setPlayerRef(camera.angle)}
                angle={camera.angle}
                frames={camera.frames}
                config={camera.config}
                currentFrame={currentFrame}
                isActive={camera.isActive}
                overlayMetadata={camera.angle === "front" ? frontMetadata : undefined}
              />
            </div>
          ))}
        </div>
        {hasRear && (
          <div className="h-1/4 flex justify-center">
            <div className="w-1/3">
              <VideoPlayer
                key="rear"
                ref={setPlayerRef("rear")}
                angle="rear"
                frames={rearCamera.frames}
                config={rearCamera.config}
                currentFrame={currentFrame}
                isActive={rearCamera.isActive}
              />
            </div>
          </div>
        )}
      </div>
    );
  }
);

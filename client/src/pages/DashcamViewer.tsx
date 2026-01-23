import { useState, useCallback, useRef, useEffect } from "react";
import { VideoGrid, type VideoGridHandle } from "@/components/VideoGrid";
import { PlaybackControls } from "@/components/PlaybackControls";
import { TelemetryHUD } from "@/components/TelemetryHUD";
import { DropZone } from "@/components/DropZone";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { CameraAngle, VideoFrame, VideoConfig, SeiMetadataRaw, FieldInfo } from "@/lib/dashcam/types";

interface CameraData {
  angle: CameraAngle;
  file: File | null;
  frames: VideoFrame[];
  config: VideoConfig | null;
  isActive: boolean;
}

function detectCameraAngle(filename: string): CameraAngle | null {
  const lower = filename.toLowerCase();
  if (lower.includes('front')) return 'front';
  if (lower.includes('left_repeater') || lower.includes('left-repeater') || (lower.includes('left') && !lower.includes('right'))) return 'left';
  if (lower.includes('right_repeater') || lower.includes('right-repeater') || (lower.includes('right') && !lower.includes('left'))) return 'right';
  if (lower.includes('back') || lower.includes('rear')) return 'rear';
  return null;
}

export default function DashcamViewer() {
  const [cameras, setCameras] = useState<CameraData[]>([
    { angle: 'front', file: null, frames: [], config: null, isActive: false },
    { angle: 'left', file: null, frames: [], config: null, isActive: false },
    { angle: 'right', file: null, frames: [], config: null, isActive: false },
    { angle: 'rear', file: null, frames: [], config: null, isActive: false },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasVideos, setHasVideos] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [currentMetadata, setCurrentMetadata] = useState<SeiMetadataRaw | null>(null);
  const [seiType, setSeiType] = useState<any>(null);
  const [seiFields, setSeiFields] = useState<FieldInfo[] | null>(null);
  const [primaryFilename, setPrimaryFilename] = useState<string>("");
  
  const videoGridRef = useRef<VideoGridHandle>(null);
  const playTimerRef = useRef<number | null>(null);
  const frameDurationsRef = useRef<number[]>([]);
  const firstKeyframeRef = useRef(0);

  useEffect(() => {
    const initProtobuf = async () => {
      if (window.DashcamHelpers) {
        try {
          const { SeiMetadata, enumFields } = await window.DashcamHelpers.initProtobuf('/dashcam.proto');
          setSeiType(SeiMetadata);
          setSeiFields(window.DashcamHelpers.deriveFieldInfo(SeiMetadata, enumFields, { useLabels: true }));
        } catch (err) {
          console.error('Failed to initialize protobuf:', err);
        }
      }
    };
    initProtobuf();
  }, []);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    if (files.length === 0 || !seiType) return;

    setIsLoading(true);
    setIsPlaying(false);
    setCurrentFrame(0);

    try {
      const newCameras: CameraData[] = [
        { angle: 'front', file: null, frames: [], config: null, isActive: false },
        { angle: 'left', file: null, frames: [], config: null, isActive: false },
        { angle: 'right', file: null, frames: [], config: null, isActive: false },
        { angle: 'rear', file: null, frames: [], config: null, isActive: false },
      ];

      let maxFrames = 0;
      let primaryFile: File | null = null;
      let primaryFrames: VideoFrame[] = [];

      for (const file of files) {
        const angle = detectCameraAngle(file.name);
        if (!angle) continue;

        const cameraIndex = newCameras.findIndex(c => c.angle === angle);
        if (cameraIndex === -1) continue;

        try {
          const buffer = await file.arrayBuffer();
          const mp4 = new window.DashcamMP4(buffer);
          const config = mp4.getConfig();
          const frames = mp4.parseFrames(seiType);

          if (frames.length > 0) {
            newCameras[cameraIndex] = {
              angle,
              file,
              frames,
              config,
              isActive: true,
            };

            if (frames.length > maxFrames) {
              maxFrames = frames.length;
              primaryFile = file;
              primaryFrames = frames;
              frameDurationsRef.current = config.durations;
              firstKeyframeRef.current = frames.findIndex(f => f.keyframe);
            }
          }
        } catch (err) {
          console.error(`Failed to load ${file.name}:`, err);
        }
      }

      const hasAnyVideo = newCameras.some(c => c.isActive);
      setCameras(newCameras);
      setHasVideos(hasAnyVideo);
      setTotalFrames(maxFrames);
      setPrimaryFilename(primaryFile?.name || "");

      if (hasAnyVideo && primaryFrames.length > 0) {
        const startFrame = Math.max(0, firstKeyframeRef.current);
        setCurrentFrame(startFrame);
        
        const sei = primaryFrames[startFrame]?.sei || null;
        setCurrentMetadata(sei);

        setTimeout(() => {
          videoGridRef.current?.renderAllFrames(startFrame);
        }, 100);
      }
    } catch (err) {
      console.error('Error loading files:', err);
    } finally {
      setIsLoading(false);
    }
  }, [seiType]);

  const getCurrentDuration = useCallback(() => {
    if (totalFrames === 0) return 0;
    const avgDuration = frameDurationsRef.current.length > 0
      ? frameDurationsRef.current.reduce((a, b) => a + b, 0) / frameDurationsRef.current.length
      : 33.33;
    return (totalFrames * avgDuration) / 1000;
  }, [totalFrames]);

  const getCurrentTime = useCallback(() => {
    if (totalFrames === 0) return 0;
    const avgDuration = frameDurationsRef.current.length > 0
      ? frameDurationsRef.current.reduce((a, b) => a + b, 0) / frameDurationsRef.current.length
      : 33.33;
    return (currentFrame * avgDuration) / 1000;
  }, [currentFrame, totalFrames]);

  const updateMetadata = useCallback((frameIndex: number) => {
    const frontCamera = cameras.find(c => c.angle === 'front' && c.isActive);
    if (frontCamera && frontCamera.frames[frameIndex]?.sei) {
      setCurrentMetadata(frontCamera.frames[frameIndex].sei);
    } else {
      const anyActiveCamera = cameras.find(c => c.isActive && c.frames[frameIndex]?.sei);
      setCurrentMetadata(anyActiveCamera?.frames[frameIndex]?.sei || null);
    }
  }, [cameras]);

  const handlePlay = useCallback(() => {
    if (!hasVideos || totalFrames === 0) return;
    setIsPlaying(true);
  }, [hasVideos, totalFrames]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    if (playTimerRef.current) {
      clearTimeout(playTimerRef.current);
      playTimerRef.current = null;
    }
  }, []);

  const handleSeek = useCallback((frame: number) => {
    handlePause();
    const clampedFrame = Math.max(0, Math.min(frame, totalFrames - 1));
    setCurrentFrame(clampedFrame);
    updateMetadata(clampedFrame);
    videoGridRef.current?.renderAllFrames(clampedFrame);
  }, [handlePause, totalFrames, updateMetadata]);

  useEffect(() => {
    if (!isPlaying || totalFrames === 0) return;

    const playNextFrame = () => {
      setCurrentFrame(prev => {
        let next = prev + 1;
        if (next >= totalFrames) {
          next = Math.max(0, firstKeyframeRef.current);
        }
        updateMetadata(next);
        videoGridRef.current?.renderAllFrames(next);
        return next;
      });

      const duration = frameDurationsRef.current[currentFrame] || 33.33;
      playTimerRef.current = window.setTimeout(playNextFrame, duration);
    };

    const duration = frameDurationsRef.current[currentFrame] || 33.33;
    playTimerRef.current = window.setTimeout(playNextFrame, duration);

    return () => {
      if (playTimerRef.current) {
        clearTimeout(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, [isPlaying, totalFrames, currentFrame, updateMetadata]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!hasVideos) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          isPlaying ? handlePause() : handlePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (currentFrame > 0) {
            handleSeek(currentFrame - 1);
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (currentFrame < totalFrames - 1) {
            handleSeek(currentFrame + 1);
          }
          break;
        case 'Home':
          e.preventDefault();
          handleSeek(0);
          break;
        case 'End':
          e.preventDefault();
          handleSeek(totalFrames - 1);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasVideos, isPlaying, currentFrame, totalFrames, handlePlay, handlePause, handleSeek]);

  const handleExportCSV = useCallback(() => {
    if (!hasVideos || !seiFields) return;

    const frontCamera = cameras.find(c => c.angle === 'front' && c.isActive);
    const sourceCamera = frontCamera || cameras.find(c => c.isActive);
    
    if (!sourceCamera) return;

    const messages = sourceCamera.frames
      .map(f => f.sei)
      .filter((sei): sei is SeiMetadataRaw => sei !== null);

    if (messages.length === 0) {
      alert('No SEI metadata to export.');
      return;
    }

    const csv = window.DashcamHelpers.buildCsv(
      messages, 
      window.DashcamHelpers.deriveFieldInfo(seiType, window.DashcamHelpers.getProtobuf()?.enumFields || {}, { useSnakeCase: true })
    );
    
    const filename = primaryFilename.replace(/\.mp4$/i, '') + '_sei.csv';
    window.DashcamHelpers.downloadBlob(
      new Blob([csv], { type: 'text/csv' }),
      filename
    );
  }, [hasVideos, seiFields, cameras, seiType, primaryFilename]);

  const handleClearVideos = useCallback(() => {
    handlePause();
    setCameras([
      { angle: 'front', file: null, frames: [], config: null, isActive: false },
      { angle: 'left', file: null, frames: [], config: null, isActive: false },
      { angle: 'right', file: null, frames: [], config: null, isActive: false },
      { angle: 'rear', file: null, frames: [], config: null, isActive: false },
    ]);
    setHasVideos(false);
    setCurrentFrame(0);
    setTotalFrames(0);
    setCurrentMetadata(null);
    setPrimaryFilename("");
  }, [handlePause]);

  return (
    <div className="h-screen flex flex-col bg-[#181818] overflow-hidden">
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-black border-b border-[#393C41]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center">
            <svg 
              viewBox="0 0 32 32" 
              className="w-6 h-6 text-[#E82127]"
              fill="currentColor"
            >
              <path d="M16 0L3 8v16l13 8 13-8V8L16 0zm0 4l9 5.5v11L16 26l-9-5.5v-11L16 4z"/>
              <path d="M16 10l-4 2.5v5l4 2.5 4-2.5v-5L16 10z"/>
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white tracking-tight">
              Tesla Dashcam Viewer
            </h1>
            <p className="text-xs text-white/50">
              Multi-angle synchronized footage with telemetry
            </p>
          </div>
        </div>
        
        {hasVideos && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleClearVideos}
            className="text-white/70 hover:text-white hover:bg-[#393C41]"
            data-testid="button-clear"
          >
            <X className="w-4 h-4 mr-2" />
            Clear
          </Button>
        )}
      </header>

      <main className="flex-1 min-h-0 flex flex-col">
        {!hasVideos ? (
          <div className="flex-1 p-4">
            <DropZone 
              onFilesSelected={handleFilesSelected}
              isLoading={isLoading}
            />
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0">
              <VideoGrid
                ref={videoGridRef}
                cameras={cameras}
                currentFrame={currentFrame}
              />
            </div>

            <PlaybackControls
              isPlaying={isPlaying}
              currentFrame={currentFrame}
              totalFrames={totalFrames}
              currentTime={getCurrentTime()}
              duration={getCurrentDuration()}
              onPlay={handlePlay}
              onPause={handlePause}
              onSeek={handleSeek}
              onExport={handleExportCSV}
              disabled={!hasVideos}
            />

            <TelemetryHUD
              metadata={currentMetadata}
              frameNumber={currentFrame}
              totalFrames={totalFrames}
              currentTime={getCurrentTime()}
              duration={getCurrentDuration()}
              filename={primaryFilename}
            />
          </>
        )}
      </main>
    </div>
  );
}

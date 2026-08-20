import { useState, useCallback, useRef, useEffect } from "react";
import { VideoGrid, type VideoGridHandle } from "@/components/VideoGrid";
import { PlaybackControls } from "@/components/PlaybackControls";
import { TelemetryHUD } from "@/components/TelemetryHUD";
import { MapView, type LatLng } from "@/components/MapView";
import { TeslaDriveBrowser } from "@/components/TeslaDriveBrowser";
import { VideoExportDialog } from "@/components/VideoExportDialog";
import { Button } from "@/components/ui/button";
import { LogOut, UserRound, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import type { CameraAngle, VideoFrame, VideoConfig, SeiMetadataRaw, FieldInfo } from "@/lib/dashcam/types";
import { detectCameraFromFilename, isPlayableDashcamMp4 } from "@/lib/dashcam/teslaDriveTraversal";
import {
  decryptTeslaEncryptedClip,
  inspectTeslaEncryptedClip,
  requestTeslaDecryptionKeys,
} from "@/lib/dashcam/teslaEncryptedClip";

interface CameraData {
  angle: CameraAngle;
  file: File | null;
  frames: VideoFrame[];
  config: VideoConfig | null;
  isActive: boolean;
}

function detectCameraAngle(filename: string): CameraAngle | null {
  return detectCameraFromFilename(filename)?.slot ?? null;
}

export default function DashcamViewer() {
  const { user, signOut } = useAuth();
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
  const seiTypeRef = useRef<any>(null);
  const [primaryFilename, setPrimaryFilename] = useState<string>("");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [gpsPath, setGpsPath] = useState<LatLng[]>([]);
  const [mapKey, setMapKey] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);

  const [videoLoadKey, setVideoLoadKey] = useState(0);

  const videoGridRef = useRef<VideoGridHandle>(null);
  const playTimerRef = useRef<number | null>(null);
  const frameDurationsRef = useRef<number[]>([]);
  const firstKeyframeRef = useRef(0);
  const currentFrameRef = useRef(0);
  const loadIdRef = useRef(0);

  // Phase 2 stabilization: generation token to make the recursive playback
  // timer chain tolerant of rapid play/pause/seek/load sequences.
  const playbackGenRef = useRef(0);

  useEffect(() => {
    const initProtobuf = async () => {
      if (window.DashcamHelpers) {
        try {
          const { SeiMetadata, enumFields } = await window.DashcamHelpers.initProtobuf('/dashcam.proto');
          seiTypeRef.current = SeiMetadata;
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
    const sei = seiTypeRef.current ?? seiType;
    if (files.length === 0) {
      throw new Error("No video files were selected.");
    }
    if (!sei) {
      throw new Error("Telemetry parser is still starting. Try Load again in a moment.");
    }
    if (!window.DashcamMP4) {
      throw new Error("Video parser failed to load. Refresh the page and try again.");
    }

    // Load generation counter + timer guard.
    // We use a monotonically increasing `myId` so that slow file reads or
    // protobuf parsing from an earlier load are discarded if a newer load
    // has already started. Combined with the explicit stopPlaybackTimer(),
    // this prevents a previous playback loop from continuing after the user
    // loads a new event.
    const myId = ++loadIdRef.current;

    stopPlaybackTimer();
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
        if (!isPlayableDashcamMp4(file.name)) continue;
        const angle = detectCameraAngle(file.name);
        if (!angle) continue;

        const cameraIndex = newCameras.findIndex(c => c.angle === angle);
        if (cameraIndex === -1) continue;

        try {
          const buffer = await file.arrayBuffer();

          // Discard work from a previous (now stale) load attempt.
          if (myId !== loadIdRef.current) return;

          const mp4 = new window.DashcamMP4(buffer);
          const config = mp4.getConfig();
          const frames = mp4.parseFrames(sei);

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

      // Final stale-load check before committing any state.
      if (myId !== loadIdRef.current) return;

      const hasAnyVideo = newCameras.some(c => c.isActive);
      const skipped = files.filter((f) => !detectCameraAngle(f.name)).map((f) => f.name);

      setCameras(newCameras);
      setHasVideos(hasAnyVideo);
      setTotalFrames(maxFrames);
      setPrimaryFilename(primaryFile?.name || "");

      if (!hasAnyVideo) {
        const names = files.map((f) => f.name).join(", ");
        const extra = skipped.length > 0
          ? ` Unrecognized filenames: ${skipped.join(", ")}.`
          : "";
        throw new Error(`Could not load camera video from: ${names}.${extra}`);
      }

      if (hasAnyVideo && primaryFrames.length > 0) {
        // Force a fresh VideoGrid + VideoPlayer tree on every new successful load.
        // This is the simplest way to guarantee completely clean decoder state
        // and layout for a different clip, even after the decoder-reuse work.
        // See the detailed comment near the videoLoadKey declaration for rationale.
        setVideoLoadKey(k => k + 1);

        const startFrame = Math.max(0, firstKeyframeRef.current);
        setCurrentFrame(startFrame);
        
        const sei = primaryFrames[startFrame]?.sei || null;
        setCurrentMetadata(sei);

        const path: LatLng[] = primaryFrames.map((f) => ({
          lat: f.sei?.latitudeDeg ?? 0,
          lng: f.sei?.longitudeDeg ?? 0,
        }));
        setGpsPath(path);
        setMapKey((k) => k + 1);
      }
    } catch (err) {
      console.error('Error loading files:', err);
      throw err;
    } finally {
      // Only clear the loading spinner if we are still the active load.
      if (myId === loadIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [seiType]);

  const handleEncryptedFilesSelected = useCallback(async (
    encryptedFiles: File[],
    authorization: string,
  ) => {
    if (!authorization.trim()) {
      throw new Error("Paste a current Tesla Dashcam Viewer authorization to decrypt clips.");
    }

    const metadata = await Promise.all(encryptedFiles.map(inspectTeslaEncryptedClip));
    const results = await requestTeslaDecryptionKeys(authorization, metadata);
    const missingKey = metadata.find((clip) => {
      const result = results.get(clip.id);
      return !result?.key;
    });
    if (missingKey) {
      const result = results.get(missingKey.id);
      throw new Error(
        result?.error
          ? `Tesla could not authorize ${missingKey.id}: ${result.error}`
          : "Tesla did not return a decryption key for one or more selected clips.",
      );
    }

    const decryptedFiles = await Promise.all(metadata.map((clip, index) =>
      decryptTeslaEncryptedClip(encryptedFiles[index], clip, results.get(clip.id)!.key!),
    ));
    await handleFilesSelected(decryptedFiles);
  }, [handleFilesSelected]);

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

    // Phase 2: Bump generation so any in-flight timers from the previous
    // play session are ignored by the guard in the playback effect.
    playbackGenRef.current += 1;

    // Reset the painted-frame guard on every fresh play start.
    // This prevents early frames (especially at the very beginning of a clip)
    // from being suppressed by a stale high value left over from previous
    // playback or seeking.
    videoGridRef.current?.renderAllFrames(currentFrame); // trigger reset inside players
    // We also do an explicit reset via a tiny seek to the same frame so the
    // guard logic inside VideoPlayer fires.
    // Simpler: just tell the players to allow the current frame again.
    // The cleanest way is to let the players reset when they see a "new session".
    // For now we force a render which will hit the backward-seek reset if needed.

    setIsPlaying(true);
  }, [hasVideos, totalFrames, currentFrame]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    stopPlaybackTimer();
  }, []);

  const handleSeek = useCallback((frame: number, opts?: { pause?: boolean }) => {
    if (opts?.pause !== false) {
      handlePause();
    }
    const clampedFrame = Math.max(0, Math.min(frame, totalFrames - 1));
    currentFrameRef.current = clampedFrame;
    setCurrentFrame(clampedFrame);
    updateMetadata(clampedFrame);
    videoGridRef.current?.renderAllFrames(clampedFrame);
  }, [handlePause, totalFrames, updateMetadata]);

  const handleScrubStart = useCallback(() => {
    playbackGenRef.current += 1;
    setIsScrubbing(true);
  }, []);

  const handleScrubEnd = useCallback(() => {
    setIsScrubbing(false);
  }, []);

  useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  // Phase 2: Centralized timer cleanup helper. All pause/seek/load/clear paths
  // should go through this to guarantee no orphaned timers.
  const stopPlaybackTimer = () => {
    if (playTimerRef.current) {
      clearTimeout(playTimerRef.current);
      playTimerRef.current = null;
    }
  };

  // Playback scheduler (setTimeout chain driven by per-frame durations).
  // This is intentionally simple; the heavy stabilization work is in VideoPlayer
  // (decoder reuse). Future improvement: time-based scheduler using performance.now().
  //
  // Phase 2: The effect now captures a generation token so that late-firing
  // timers from previous play sessions are harmless.
  useEffect(() => {
    if (!isPlaying || isScrubbing || totalFrames === 0) return;

    const myGen = playbackGenRef.current;

    const playNextFrame = () => {
      // Phase 2 guard: if we've paused, sought, or started a new play session,
      // ignore this late timer callback.
      if (!isPlaying || playbackGenRef.current !== myGen) return;

      const prevFrame = currentFrameRef.current;
      let next = prevFrame + 1;
      if (next >= totalFrames) {
        next = Math.max(0, firstKeyframeRef.current);
      }

      currentFrameRef.current = next;
      setCurrentFrame(next);
      updateMetadata(next);
      videoGridRef.current?.renderAllFrames(next);

      const duration = frameDurationsRef.current[next] || 33.33;
      playTimerRef.current = window.setTimeout(playNextFrame, duration);
    };

    const duration = frameDurationsRef.current[currentFrameRef.current] || 33.33;
    playTimerRef.current = window.setTimeout(playNextFrame, duration);

    return stopPlaybackTimer;
  }, [isPlaying, isScrubbing, totalFrames, updateMetadata]);

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
    
    const baseName = primaryFilename ? primaryFilename.replace(/\.mp4$/i, '') : 'dashcam_export';
    const filename = `${baseName}_sei.csv`;
    window.DashcamHelpers.downloadBlob(
      new Blob([csv], { type: 'text/csv' }),
      filename
    );
  }, [hasVideos, seiFields, cameras, seiType, primaryFilename]);

  const handleClearVideos = useCallback(() => {
    // Phase 2: handlePause already stops the timer; explicit call here is for clarity
    // during full reset paths.
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
    setGpsPath([]);
  }, [handlePause]);

  const handleExportVideo = useCallback(() => {
    handlePause();
    setExportDialogOpen(true);
  }, [handlePause]);

  return (
    <div className="relative h-screen flex flex-col bg-[#181818] overflow-hidden">
      <div className="absolute right-3 top-3 z-50 flex items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-xs text-white/75 shadow-lg backdrop-blur">
        <UserRound className="h-3.5 w-3.5 text-[#e82127]" />
        <span className="max-w-28 truncate">{user?.username}</span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="ml-1 rounded-full p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
      <main className="flex-1 min-h-0 flex flex-col">
        {/* TeslaDriveBrowser is kept mounted (but hidden) while videos are playing
            so that driveData, expanded categories, and checked cameras survive
            between loads without being reset. */}
        <div className={!hasVideos ? "flex-1 p-4 min-h-0 overflow-y-auto" : "hidden"}>
          <TeslaDriveBrowser
            onFilesSelected={handleFilesSelected}
            onDecryptEncryptedFiles={handleEncryptedFilesSelected}
            isLoading={isLoading}
          />
        </div>

        {hasVideos && (
          <>
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 overflow-y-auto">
                <VideoGrid
                  key={videoLoadKey}
                  ref={videoGridRef}
                  cameras={cameras}
                  currentFrame={currentFrame}
                  frontMetadata={currentMetadata}
                  isPlaying={isPlaying}
                />
              </div>

              <div className="h-52 shrink-0 overflow-hidden sm:h-64">
                <MapView
                  key={mapKey}
                  path={gpsPath}
                  currentIndex={currentFrame}
                />
              </div>
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
              onScrubStart={handleScrubStart}
              onScrubEnd={handleScrubEnd}
              onExportVideo={handleExportVideo}
              onClear={handleClearVideos}
              disabled={!hasVideos}
            />

            <TelemetryHUD
              metadata={currentMetadata}
              frameNumber={currentFrame}
              totalFrames={totalFrames}
              currentTime={getCurrentTime()}
              duration={getCurrentDuration()}
            />
          </>
        )}
      </main>

      <VideoExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        cameras={cameras}
        frameDurations={frameDurationsRef.current}
        primaryFilename={primaryFilename}
      />
    </div>
  );
}

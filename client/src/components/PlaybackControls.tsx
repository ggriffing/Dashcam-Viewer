import { Play, Pause, SkipBack, SkipForward, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PlaybackControlsProps {
  isPlaying: boolean;
  currentFrame: number;
  totalFrames: number;
  currentTime: number;
  duration: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (frame: number) => void;
  onExport?: () => void;
  disabled: boolean;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function PlaybackControls({
  isPlaying,
  currentFrame,
  totalFrames,
  currentTime,
  duration,
  onPlay,
  onPause,
  onSeek,
  onExport,
  disabled,
}: PlaybackControlsProps) {
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSeek(parseInt(e.target.value, 10));
  };

  const handleStepBack = () => {
    if (currentFrame > 0) {
      onSeek(currentFrame - 1);
    }
  };

  const handleStepForward = () => {
    if (currentFrame < totalFrames - 1) {
      onSeek(currentFrame + 1);
    }
  };

  const progress = totalFrames > 0 ? (currentFrame / (totalFrames - 1)) * 100 : 0;

  return (
    <div 
      className="w-full bg-[#181818] border-t border-[#393C41] px-4 py-3 controls-fade"
      data-testid="playback-controls"
    >
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            onClick={handleStepBack}
            disabled={disabled || currentFrame === 0}
            className="text-white hover:bg-[#393C41] hover:text-white"
            data-testid="button-step-back"
          >
            <SkipBack className="w-4 h-4" />
          </Button>

          <Button
            size="icon"
            variant="default"
            onClick={isPlaying ? onPause : onPlay}
            disabled={disabled}
            className="bg-[#E82127] hover:bg-[#C41E22] text-white w-10 h-10"
            data-testid="button-play-pause"
          >
            {isPlaying ? (
              <Pause className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5 ml-0.5" />
            )}
          </Button>

          <Button
            size="icon"
            variant="ghost"
            onClick={handleStepForward}
            disabled={disabled || currentFrame >= totalFrames - 1}
            className="text-white hover:bg-[#393C41] hover:text-white"
            data-testid="button-step-forward"
          >
            <SkipForward className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2 text-sm font-mono text-white/80">
          <span data-testid="text-current-time">{formatTime(currentTime)}</span>
        </div>

        <div className="flex-1 relative">
          <div className="relative h-6 flex items-center">
            <div className="absolute inset-x-0 h-1 bg-[#393C41] rounded-full overflow-hidden">
              <div 
                className="h-full bg-[#E82127] transition-all duration-100"
                style={{ width: `${progress}%` }}
              />
            </div>
            <input
              type="range"
              min="0"
              max={Math.max(totalFrames - 1, 0)}
              value={currentFrame}
              onChange={handleSliderChange}
              disabled={disabled}
              className="video-slider absolute inset-x-0 w-full z-10"
              data-testid="slider-timeline"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm font-mono text-white/80">
          <span data-testid="text-duration">{formatTime(duration)}</span>
        </div>

        {onExport && (
          <Button
            size="sm"
            variant="outline"
            onClick={onExport}
            disabled={disabled}
            className="border-[#393C41] text-white hover:bg-[#393C41] hover:text-white"
            data-testid="button-export"
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        )}
      </div>
    </div>
  );
}

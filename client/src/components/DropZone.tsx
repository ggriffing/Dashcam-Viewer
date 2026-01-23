import { useCallback, useState } from "react";
import { Upload, Video, FolderOpen } from "lucide-react";

interface DropZoneProps {
  onFilesSelected: (files: File[]) => void;
  isLoading: boolean;
}

export function DropZone({ onFilesSelected, isLoading }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const items = e.dataTransfer?.items;
    if (items && window.DashcamHelpers) {
      try {
        const { files } = await window.DashcamHelpers.getFilesFromDataTransfer(items);
        if (files.length > 0) {
          onFilesSelected(files);
        }
      } catch {
        const fileList = e.dataTransfer?.files;
        if (fileList) {
          const mp4Files = Array.from(fileList).filter(f => 
            f.name.toLowerCase().endsWith('.mp4')
          );
          if (mp4Files.length > 0) {
            onFilesSelected(mp4Files);
          }
        }
      }
    } else {
      const fileList = e.dataTransfer?.files;
      if (fileList) {
        const mp4Files = Array.from(fileList).filter(f => 
          f.name.toLowerCase().endsWith('.mp4')
        );
        if (mp4Files.length > 0) {
          onFilesSelected(mp4Files);
        }
      }
    }
  }, [onFilesSelected]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList) {
      const mp4Files = Array.from(fileList).filter(f => 
        f.name.toLowerCase().endsWith('.mp4')
      );
      if (mp4Files.length > 0) {
        onFilesSelected(mp4Files);
      }
    }
    e.target.value = '';
  }, [onFilesSelected]);

  const handleClick = useCallback(() => {
    document.getElementById('file-input')?.click();
  }, []);

  return (
    <div 
      className={`
        w-full h-full min-h-[400px] flex flex-col items-center justify-center
        border-2 border-dashed rounded-lg cursor-pointer
        transition-all duration-200
        ${isDragOver 
          ? 'border-[#E82127] bg-[#E82127]/10' 
          : 'border-[#393C41] bg-[#181818] hover:border-[#E82127]/50 hover:bg-[#1a1a1a]'
        }
        ${isLoading ? 'pointer-events-none opacity-50' : ''}
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      data-testid="dropzone"
    >
      <input
        id="file-input"
        type="file"
        accept="video/mp4"
        multiple
        onChange={handleFileInput}
        className="hidden"
        data-testid="input-file"
      />

      {isLoading ? (
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#E82127] border-t-transparent rounded-full animate-spin" />
          <p className="text-white/70 text-lg">Loading videos...</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-6 px-8 text-center">
          <div className="relative">
            <div className="absolute inset-0 bg-[#E82127]/20 rounded-full blur-xl" />
            <div className="relative w-20 h-20 bg-[#E82127]/10 rounded-full flex items-center justify-center border border-[#E82127]/30">
              <Upload className="w-10 h-10 text-[#E82127]" />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xl font-semibold text-white">
              Drop Tesla Dashcam Files
            </h3>
            <p className="text-white/60 text-sm max-w-md">
              Drop your Tesla dashcam MP4 files or folder here. 
              Select files for front, left, right, and rear cameras 
              to view synchronized multi-angle footage.
            </p>
          </div>

          <div className="flex items-center gap-6 text-white/50 text-sm">
            <div className="flex items-center gap-2">
              <Video className="w-4 h-4" />
              <span>MP4 files</span>
            </div>
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4" />
              <span>Or drag folder</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-white/40">
            <div className="flex items-center gap-2 bg-[#393C41]/30 px-3 py-2 rounded">
              <span className="text-[#00FF00]">FRONT</span>
              <span>*-front.mp4</span>
            </div>
            <div className="flex items-center gap-2 bg-[#393C41]/30 px-3 py-2 rounded">
              <span className="text-[#00FF00]">LEFT</span>
              <span>*-left_repeater.mp4</span>
            </div>
            <div className="flex items-center gap-2 bg-[#393C41]/30 px-3 py-2 rounded">
              <span className="text-[#00FF00]">RIGHT</span>
              <span>*-right_repeater.mp4</span>
            </div>
            <div className="flex items-center gap-2 bg-[#393C41]/30 px-3 py-2 rounded">
              <span className="text-[#00FF00]">REAR</span>
              <span>*-back.mp4</span>
            </div>
          </div>

          <p className="text-xs text-white/30 mt-2">
            Requires Tesla firmware 2025.44.25+ and HW3+ for SEI telemetry data
          </p>
        </div>
      )}
    </div>
  );
}

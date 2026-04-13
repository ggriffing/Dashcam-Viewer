import { useCallback, useState } from "react";
import { Upload, Video, FolderOpen, X, Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StagedFile {
  file: File;
  angle: string | null;
}

interface DropZoneProps {
  onFilesSelected: (files: File[]) => void;
  isLoading: boolean;
}

function detectCameraAngle(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower.includes('front')) return 'front';
  if (lower.includes('left_pillar') || lower.includes('left-pillar')) return 'left';
  if (lower.includes('right_pillar') || lower.includes('right-pillar')) return 'right';
  if (lower.includes('left_repeater') || lower.includes('left-repeater') || (lower.includes('left') && !lower.includes('right'))) return 'left';
  if (lower.includes('right_repeater') || lower.includes('right-repeater') || (lower.includes('right') && !lower.includes('left'))) return 'right';
  if (lower.includes('back') || lower.includes('rear')) return 'rear';
  return null;
}

export function DropZone({ onFilesSelected, isLoading }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);

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

  const addFiles = useCallback((files: File[]) => {
    const mp4Files = files.filter(f => f.name.toLowerCase().endsWith('.mp4'));
    
    setStagedFiles(prev => {
      const newStaged = [...prev];
      
      for (const file of mp4Files) {
        const angle = detectCameraAngle(file.name);
        
        if (angle) {
          const existingIndex = newStaged.findIndex(sf => sf.angle === angle);
          if (existingIndex >= 0) {
            newStaged[existingIndex] = { file, angle };
          } else {
            newStaged.push({ file, angle });
          }
        } else {
          newStaged.push({ file, angle: null });
        }
      }
      
      return newStaged;
    });
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
          addFiles(files);
        }
      } catch {
        const fileList = e.dataTransfer?.files;
        if (fileList) {
          addFiles(Array.from(fileList));
        }
      }
    } else {
      const fileList = e.dataTransfer?.files;
      if (fileList) {
        addFiles(Array.from(fileList));
      }
    }
  }, [addFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList) {
      addFiles(Array.from(fileList));
    }
    e.target.value = '';
  }, [addFiles]);

  const handleClick = useCallback(() => {
    document.getElementById('file-input')?.click();
  }, []);

  const handleRemoveFile = useCallback((index: number) => {
    setStagedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleLoadVideos = useCallback(() => {
    if (stagedFiles.length > 0) {
      onFilesSelected(stagedFiles.map(sf => sf.file));
      setStagedFiles([]);
    }
  }, [stagedFiles, onFilesSelected]);

  const handleClearAll = useCallback(() => {
    setStagedFiles([]);
  }, []);

  const getAngleLabel = (angle: string | null) => {
    if (!angle) return 'Unknown';
    return angle.charAt(0).toUpperCase() + angle.slice(1);
  };

  const getAngleColor = (angle: string | null) => {
    switch (angle) {
      case 'front': return 'text-green-400';
      case 'left': return 'text-blue-400';
      case 'right': return 'text-yellow-400';
      case 'rear': return 'text-purple-400';
      default: return 'text-white/50';
    }
  };

  const assignedAngles = stagedFiles.filter(sf => sf.angle).map(sf => sf.angle);

  return (
    <div className="w-full h-full min-h-[400px] flex flex-col">
      <div 
        className={`
          flex-1 flex flex-col items-center justify-center
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
        onClick={stagedFiles.length === 0 ? handleClick : undefined}
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
        ) : stagedFiles.length === 0 ? (
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
                You can drop multiple files - they will be staged 
                until you click "Load Videos".
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
                <span className="text-green-400">FRONT</span>
                <span>*-front.mp4</span>
              </div>
              <div className="flex items-center gap-2 bg-[#393C41]/30 px-3 py-2 rounded">
                <span className="text-blue-400">LEFT</span>
                <span>*-left_repeater.mp4</span>
              </div>
              <div className="flex items-center gap-2 bg-[#393C41]/30 px-3 py-2 rounded">
                <span className="text-yellow-400">RIGHT</span>
                <span>*-right_repeater.mp4</span>
              </div>
              <div className="flex items-center gap-2 bg-[#393C41]/30 px-3 py-2 rounded">
                <span className="text-purple-400">REAR</span>
                <span>*-back.mp4</span>
              </div>
            </div>

            <p className="text-xs text-white/30 mt-2">
              Requires Tesla firmware 2025.44.25+ and HW3+ for SEI telemetry data
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6 p-6 w-full max-w-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">
                Staged Files ({stagedFiles.length})
              </h3>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClick();
                  }}
                  data-testid="button-add-more"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add More
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClearAll();
                  }}
                  data-testid="button-clear-staged"
                >
                  <X className="w-4 h-4 mr-1" />
                  Clear All
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              {['front', 'left', 'right', 'rear'].map(angle => {
                const isAssigned = assignedAngles.includes(angle);
                return (
                  <div 
                    key={angle}
                    className={`flex items-center gap-2 px-3 py-2 rounded ${isAssigned ? 'bg-green-500/20 border border-green-500/30' : 'bg-[#393C41]/30'}`}
                  >
                    {isAssigned ? (
                      <Check className="w-3 h-3 text-green-400" />
                    ) : (
                      <div className="w-3 h-3 rounded-full border border-white/30" />
                    )}
                    <span className={isAssigned ? getAngleColor(angle) : 'text-white/40'}>
                      {angle.toUpperCase()}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
              {stagedFiles.map((sf, index) => (
                <div 
                  key={index}
                  className="flex items-center justify-between bg-[#393C41]/50 px-3 py-2 rounded"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Video className="w-4 h-4 text-white/50 flex-shrink-0" />
                    <span className="text-white/80 text-sm truncate">{sf.file.name}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs ${getAngleColor(sf.angle)}`}>
                      {getAngleLabel(sf.angle)}
                    </span>
                    <button
                      onClick={() => handleRemoveFile(index)}
                      className="p-1 hover:bg-white/10 rounded"
                      data-testid={`button-remove-file-${index}`}
                    >
                      <X className="w-3 h-3 text-white/50" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div 
              className="border-2 border-dashed border-[#393C41] rounded-lg p-4 text-center cursor-pointer hover:border-[#E82127]/50 hover:bg-[#1a1a1a] transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                handleClick();
              }}
            >
              <p className="text-white/50 text-sm">
                Drop more files here or click to browse
              </p>
            </div>

            <Button
              size="lg"
              onClick={(e) => {
                e.stopPropagation();
                handleLoadVideos();
              }}
              className="w-full bg-[#E82127] hover:bg-[#E82127]/80 text-white"
              data-testid="button-load-videos"
            >
              <Check className="w-5 h-5 mr-2" />
              Load {stagedFiles.length} Video{stagedFiles.length !== 1 ? 's' : ''}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

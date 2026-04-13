import { useState, useCallback, useRef, useEffect, type RefObject } from "react";
import {
  HardDrive,
  ChevronRight,
  ChevronDown,
  Loader2,
  AlertCircle,
  Check,
  Upload,
  RefreshCw,
  Video,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  scanTeslaDrive,
  parseFolderFiles,
  type TeslaDriveData,
  type CategoryData,
  type EventEntry,
} from "@/lib/dashcam/teslaDriveTraversal";

interface TeslaDriveBrowserProps {
  onFilesSelected: (files: File[]) => void;
  isLoading: boolean;
}

function formatEventName(name: string): string {
  // 2026-03-11_11-06-32 → Mar 11, 2026  11:06:32
  const match = name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (!match) return name;
  const [, year, month, day, h, m, s] = match;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(month) - 1]} ${parseInt(day)}, ${year}  ${h}:${m}:${s}`;
}

const SLOT_COLORS: Record<string, { text: string; bg: string; border: string; label: string }> = {
  front: { text: "text-green-400", bg: "bg-green-500/20", border: "border-green-400/30", label: "FRONT" },
  left: { text: "text-blue-400", bg: "bg-blue-500/20", border: "border-blue-400/30", label: "LEFT" },
  right: { text: "text-yellow-400", bg: "bg-yellow-500/20", border: "border-yellow-400/30", label: "RIGHT" },
  rear: { text: "text-purple-400", bg: "bg-purple-500/20", border: "border-purple-400/30", label: "REAR" },
};

interface ExpandedEvent {
  categoryKey: string;
  eventName: string;
}

export function TeslaDriveBrowser({ onFilesSelected, isLoading }: TeslaDriveBrowserProps) {
  const [driveData, setDriveData] = useState<TeslaDriveData | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["SavedClips"]));
  const [expandedEvent, setExpandedEvent] = useState<ExpandedEvent | null>(null);
  const [checkedCameras, setCheckedCameras] = useState<Set<string>>(new Set());
  const [isDragOver, setIsDragOver] = useState(false);
  const [loadingEvent, setLoadingEvent] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const supportsDirectoryPicker = typeof window !== "undefined" && "showDirectoryPicker" in window;

  // webkitdirectory is not in React's types — set the attribute imperatively
  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute("webkitdirectory", "");
    }
  }, []);

  const applyDriveData = useCallback((data: TeslaDriveData) => {
    setDriveData(data);
    if (data.categories.length > 0) {
      setExpandedCategories(new Set([data.categories[0].key]));
    }
  }, []);

  // Handle the webkitdirectory folder input (cross-origin iframe fallback)
  const handleFolderInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    e.target.value = "";
    if (!fileList) return;
    setScanError(null);
    setScanning(true);
    setDriveData(null);
    setExpandedEvent(null);
    setCheckedCameras(new Set());
    try {
      const data = parseFolderFiles(Array.from(fileList));
      applyDriveData(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to parse folder contents.";
      setScanError(msg);
    } finally {
      setScanning(false);
    }
  }, [applyDriveData]);

  const handleSelectDrive = useCallback(async () => {
    setScanError(null);

    // If the Directory Picker API is unavailable, fall back immediately
    if (!supportsDirectoryPicker || !window.showDirectoryPicker) {
      folderInputRef.current?.click();
      return;
    }

    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      setScanning(true);
      setDriveData(null);
      setExpandedEvent(null);
      setCheckedCameras(new Set());
      const data = await scanTeslaDrive(handle);
      applyDriveData(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Cross-origin iframe blocks showDirectoryPicker — fall back to the
      // standard folder input which works inside iframes
      if (
        err instanceof DOMException &&
        (err.name === "SecurityError" || err.name === "NotAllowedError")
      ) {
        folderInputRef.current?.click();
        return;
      }
      const msg = err instanceof Error ? err.message : "Failed to read the selected folder.";
      setScanError(msg);
    } finally {
      setScanning(false);
    }
  }, [supportsDirectoryPicker, applyDriveData]);

  const toggleCategory = useCallback((key: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectEvent = useCallback((categoryKey: string, event: EventEntry) => {
    setExpandedEvent(prev => {
      if (prev?.categoryKey === categoryKey && prev?.eventName === event.name) return null;
      return { categoryKey, eventName: event.name };
    });
    const defaultChecked = new Set(event.cameras.map(c => c.cameraName));
    setCheckedCameras(defaultChecked);
  }, []);

  const toggleCamera = useCallback((cameraName: string) => {
    setCheckedCameras(prev => {
      const next = new Set(prev);
      if (next.has(cameraName)) next.delete(cameraName);
      else next.add(cameraName);
      return next;
    });
  }, []);

  const handleLoadEvent = useCallback(async (event: EventEntry) => {
    const selected = event.cameras.filter(c => checkedCameras.has(c.cameraName));
    if (selected.length === 0) return;
    setLoadingEvent(true);
    try {
      const files = await Promise.all(selected.map(c => c.fileHandle.getFile()));
      onFilesSelected(files);
    } catch (err) {
      console.error("Failed to read camera files:", err);
    } finally {
      setLoadingEvent(false);
    }
  }, [checkedCameras, onFilesSelected]);

  const addFiles = useCallback((files: File[]) => {
    const mp4s = files.filter(f => f.name.toLowerCase().endsWith(".mp4"));
    if (mp4s.length > 0) onFilesSelected(mp4s);
  }, [onFilesSelected]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const items = e.dataTransfer?.items;
    if (items && window.DashcamHelpers) {
      try {
        const { files } = await window.DashcamHelpers.getFilesFromDataTransfer(items);
        if (files.length > 0) { addFiles(files); return; }
      } catch { /* fall through */ }
    }
    const fileList = e.dataTransfer?.files;
    if (fileList) addFiles(Array.from(fileList));
  }, [addFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList) addFiles(Array.from(fileList));
    e.target.value = "";
  }, [addFiles]);

  if (isLoading) {
    return (
      <div className="w-full h-full min-h-[400px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#E82127] border-t-transparent rounded-full animate-spin" />
          <p className="text-white/70 text-lg">Loading videos...</p>
        </div>
      </div>
    );
  }

  const hiddenFolderInput = (
    <input
      ref={folderInputRef as RefObject<HTMLInputElement>}
      type="file"
      multiple
      onChange={handleFolderInput}
      className="hidden"
      data-testid="input-folder-fallback"
    />
  );

  if (driveData) {
    return (
      <>
        {hiddenFolderInput}
        <DriveView
          driveData={driveData}
          expandedCategories={expandedCategories}
          expandedEvent={expandedEvent}
          checkedCameras={checkedCameras}
          loadingEvent={loadingEvent}
          isDragOver={isDragOver}
          onToggleCategory={toggleCategory}
          onSelectEvent={selectEvent}
          onToggleCamera={toggleCamera}
          onLoadEvent={handleLoadEvent}
          onChangeDrive={handleSelectDrive}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
          onDrop={handleDrop}
          onFileInput={handleFileInput}
          fileInputRef={fileInputRef}
        />
      </>
    );
  }

  return (
    <>
      {hiddenFolderInput}
      <InitialView
        scanning={scanning}
        scanError={scanError}
        supportsDirectoryPicker={supportsDirectoryPicker}
        isDragOver={isDragOver}
        onSelectDrive={handleSelectDrive}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
        onDrop={handleDrop}
        onFileInput={handleFileInput}
        fileInputRef={fileInputRef}
      />
    </>
  );
}

interface InitialViewProps {
  scanning: boolean;
  scanError: string | null;
  supportsDirectoryPicker: boolean;
  isDragOver: boolean;
  onSelectDrive: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

function InitialView({
  scanning,
  scanError,
  supportsDirectoryPicker,
  isDragOver,
  onSelectDrive,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileInput,
  fileInputRef,
}: InitialViewProps) {
  return (
    <div className="w-full h-full min-h-[400px] flex flex-col gap-4">
      <div className="flex-1 flex flex-col items-center justify-center gap-8 px-8">
        <div className="relative">
          <div className="absolute inset-0 bg-[#E82127]/20 rounded-full blur-xl" />
          <div className="relative w-20 h-20 bg-[#E82127]/10 rounded-full flex items-center justify-center border border-[#E82127]/30">
            <HardDrive className="w-10 h-10 text-[#E82127]" />
          </div>
        </div>

        <div className="text-center flex flex-col gap-2">
          <h3 className="text-xl font-semibold text-white">Tesla Drive Browser</h3>
          <p className="text-white/60 text-sm max-w-md">
            Select your Tesla flash drive to browse and load dashcam footage by event.
          </p>
        </div>

        {supportsDirectoryPicker ? (
          <Button
            size="lg"
            onClick={onSelectDrive}
            disabled={scanning}
            className="bg-[#E82127] hover:bg-[#E82127]/80 text-white px-8"
            data-testid="button-select-drive"
          >
            {scanning ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Scanning drive…
              </>
            ) : (
              <>
                <HardDrive className="w-5 h-5 mr-2" />
                Select Tesla Drive
              </>
            )}
          </Button>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <p className="text-amber-400 text-sm">
              Directory picker is not supported in this browser.
            </p>
            <p className="text-white/50 text-xs">Use Chrome or Edge, or drag & drop files below.</p>
          </div>
        )}

        {scanError && (
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 max-w-md">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-red-400 text-sm">{scanError}</p>
          </div>
        )}
      </div>

      <DropFallback
        isDragOver={isDragOver}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onFileInput={onFileInput}
        fileInputRef={fileInputRef}
      />
    </div>
  );
}

interface DriveViewProps {
  driveData: TeslaDriveData;
  expandedCategories: Set<string>;
  expandedEvent: ExpandedEvent | null;
  checkedCameras: Set<string>;
  loadingEvent: boolean;
  isDragOver: boolean;
  onToggleCategory: (key: string) => void;
  onSelectEvent: (categoryKey: string, event: EventEntry) => void;
  onToggleCamera: (cameraName: string) => void;
  onLoadEvent: (event: EventEntry) => void;
  onChangeDrive: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

function DriveView({
  driveData,
  expandedCategories,
  expandedEvent,
  checkedCameras,
  loadingEvent,
  isDragOver,
  onToggleCategory,
  onSelectEvent,
  onToggleCamera,
  onLoadEvent,
  onChangeDrive,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileInput,
  fileInputRef,
}: DriveViewProps) {
  const findExpandedEventData = (): EventEntry | null => {
    if (!expandedEvent) return null;
    const cat = driveData.categories.find(c => c.key === expandedEvent.categoryKey);
    return cat?.events.find(e => e.name === expandedEvent.eventName) ?? null;
  };

  const expandedEventData = findExpandedEventData();

  const slotConflicts = expandedEventData
    ? (() => {
        const slotCounts = new Map<string, number>();
        for (const cam of expandedEventData.cameras) {
          if (checkedCameras.has(cam.cameraName)) {
            slotCounts.set(cam.slot, (slotCounts.get(cam.slot) ?? 0) + 1);
          }
        }
        return new Set(Array.from(slotCounts.entries()).filter(([, n]) => n > 1).map(([s]) => s));
      })()
    : new Set<string>();

  return (
    <div className="w-full h-full min-h-[400px] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#393C41]">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-[#E82127]" />
          <span className="text-white font-medium text-sm">{driveData.driveName}</span>
          {driveData.categories.length === 0 && (
            <span className="text-white/40 text-xs">— no clips found</span>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onChangeDrive}
          className="text-white/50 hover:text-white text-xs"
          data-testid="button-change-drive"
        >
          <RefreshCw className="w-3 h-3 mr-1" />
          Change Drive
        </Button>
      </div>

      {driveData.categories.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-white/40 text-sm">
          No dashcam clips found on this drive.
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {driveData.categories.map(category => (
            <CategorySection
              key={category.key}
              category={category}
              isExpanded={expandedCategories.has(category.key)}
              expandedEvent={expandedEvent}
              checkedCameras={checkedCameras}
              slotConflicts={slotConflicts}
              loadingEvent={loadingEvent}
              onToggle={() => onToggleCategory(category.key)}
              onSelectEvent={(event) => onSelectEvent(category.key, event)}
              onToggleCamera={onToggleCamera}
              onLoadEvent={onLoadEvent}
            />
          ))}
        </div>
      )}

      <DropFallback
        isDragOver={isDragOver}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onFileInput={onFileInput}
        fileInputRef={fileInputRef}
        compact
      />
    </div>
  );
}

interface CategorySectionProps {
  category: CategoryData;
  isExpanded: boolean;
  expandedEvent: ExpandedEvent | null;
  checkedCameras: Set<string>;
  slotConflicts: Set<string>;
  loadingEvent: boolean;
  onToggle: () => void;
  onSelectEvent: (event: EventEntry) => void;
  onToggleCamera: (cameraName: string) => void;
  onLoadEvent: (event: EventEntry) => void;
}

function CategorySection({
  category,
  isExpanded,
  expandedEvent,
  checkedCameras,
  slotConflicts,
  loadingEvent,
  onToggle,
  onSelectEvent,
  onToggleCamera,
  onLoadEvent,
}: CategorySectionProps) {
  return (
    <div className="border-b border-[#393C41]/50 last:border-b-0">
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
        onClick={onToggle}
        data-testid={`button-category-${category.key}`}
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-[#E82127]" />
          ) : (
            <ChevronRight className="w-4 h-4 text-white/40" />
          )}
          <FolderOpen className="w-4 h-4 text-white/50" />
          <span className="text-white font-medium text-sm">{category.label}</span>
        </div>
        <span className="text-white/40 text-xs">{category.events.length} events</span>
      </button>

      {isExpanded && (
        <div className="pb-1">
          {category.events.map(event => {
            const isSelected =
              expandedEvent?.categoryKey === category.key &&
              expandedEvent?.eventName === event.name;
            return (
              <EventRow
                key={event.name}
                event={event}
                isSelected={isSelected}
                checkedCameras={checkedCameras}
                slotConflicts={slotConflicts}
                loadingEvent={loadingEvent}
                onSelect={() => onSelectEvent(event)}
                onToggleCamera={onToggleCamera}
                onLoad={() => onLoadEvent(event)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

interface EventRowProps {
  event: EventEntry;
  isSelected: boolean;
  checkedCameras: Set<string>;
  slotConflicts: Set<string>;
  loadingEvent: boolean;
  onSelect: () => void;
  onToggleCamera: (cameraName: string) => void;
  onLoad: () => void;
}

function EventRow({
  event,
  isSelected,
  checkedCameras,
  slotConflicts,
  loadingEvent,
  onSelect,
  onToggleCamera,
  onLoad,
}: EventRowProps) {
  const checkedCount = event.cameras.filter(c => checkedCameras.has(c.cameraName)).length;

  return (
    <div
      className={`border-l-2 ml-4 transition-colors ${
        isSelected ? "border-[#E82127]" : "border-transparent"
      }`}
    >
      <button
        className={`w-full flex items-center justify-between px-4 py-2 hover:bg-white/5 transition-colors text-left ${
          isSelected ? "bg-white/5" : ""
        }`}
        onClick={onSelect}
        data-testid={`button-event-${event.name}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isSelected ? (
            <ChevronDown className="w-3 h-3 text-[#E82127] flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-white/30 flex-shrink-0" />
          )}
          <span className="text-white/80 text-sm truncate">{formatEventName(event.name)}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-white/30 text-xs">{event.cameras.length} cam</span>
        </div>
      </button>

      {isSelected && (
        <div className="px-6 pb-4 pt-2 flex flex-col gap-3">
          <p className="text-white/40 text-xs uppercase tracking-wider">Select cameras to load</p>
          <div className="grid grid-cols-2 gap-2">
            {event.cameras.map(cam => {
              const isChecked = checkedCameras.has(cam.cameraName);
              const colors = SLOT_COLORS[cam.slot];
              const hasConflict = slotConflicts.has(cam.slot);
              return (
                <label
                  key={cam.cameraName}
                  className={`flex items-center gap-3 px-3 py-2 rounded cursor-pointer transition-colors border ${
                    isChecked
                      ? `${colors.bg} ${colors.border}`
                      : "bg-[#393C41]/30 border-transparent hover:bg-[#393C41]/50"
                  }`}
                  data-testid={`label-camera-${cam.cameraName}`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => onToggleCamera(cam.cameraName)}
                    className="hidden"
                    data-testid={`checkbox-camera-${cam.cameraName}`}
                  />
                  <div
                    className={`w-4 h-4 rounded flex items-center justify-center border flex-shrink-0 ${
                      isChecked
                        ? "bg-[#E82127] border-[#E82127]"
                        : "border-white/30"
                    }`}
                  >
                    {isChecked && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <span className="text-white/80 text-sm flex-1">{cam.label}</span>
                  <span
                    className={`text-xs font-mono px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} ${
                      hasConflict && isChecked ? "ring-1 ring-amber-400/50" : ""
                    }`}
                  >
                    {colors.label}
                  </span>
                </label>
              );
            })}
          </div>

          {slotConflicts.size > 0 && (
            <p className="text-amber-400/70 text-xs flex items-center gap-1.5">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />
              Multiple cameras selected for the same slot — only the last one loaded will appear.
            </p>
          )}

          <Button
            size="sm"
            onClick={onLoad}
            disabled={checkedCount === 0 || loadingEvent}
            className="bg-[#E82127] hover:bg-[#E82127]/80 text-white self-start"
            data-testid="button-load-cameras"
          >
            {loadingEvent ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Loading…
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-2" />
                Load {checkedCount} Camera{checkedCount !== 1 ? "s" : ""}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

interface DropFallbackProps {
  isDragOver: boolean;
  compact?: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

function DropFallback({
  isDragOver,
  compact,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileInput,
  fileInputRef,
}: DropFallbackProps) {
  return (
    <div
      className={`
        flex items-center justify-center gap-3 cursor-pointer transition-all duration-200
        ${compact
          ? `border-t border-dashed py-3 px-4 ${isDragOver ? "border-[#E82127] bg-[#E82127]/10" : "border-[#393C41] hover:border-[#E82127]/40 hover:bg-[#1a1a1a]"}`
          : `border-2 border-dashed rounded-lg py-6 px-8 ${isDragOver ? "border-[#E82127] bg-[#E82127]/10" : "border-[#393C41] hover:border-[#E82127]/40 hover:bg-[#1a1a1a]"}`
        }
      `}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => fileInputRef.current?.click()}
      data-testid="dropzone-fallback"
    >
      <input
        ref={fileInputRef as RefObject<HTMLInputElement>}
        type="file"
        accept="video/mp4"
        multiple
        onChange={onFileInput}
        className="hidden"
        data-testid="input-file-fallback"
      />
      {isDragOver ? (
        <Upload className="w-4 h-4 text-[#E82127]" />
      ) : (
        <Video className="w-4 h-4 text-white/30" />
      )}
      <span className={`text-sm ${isDragOver ? "text-[#E82127]" : "text-white/30"}`}>
        {isDragOver ? "Drop MP4 files to load" : "Or drag & drop MP4 files here"}
      </span>
    </div>
  );
}

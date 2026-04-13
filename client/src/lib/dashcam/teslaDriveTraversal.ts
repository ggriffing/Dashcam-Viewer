export type CameraSlot = "front" | "left" | "right" | "rear";

export interface CameraEntry {
  cameraName: string;
  label: string;
  slot: CameraSlot;
  fileHandle: FileSystemFileHandle;
}

export interface EventEntry {
  name: string;
  cameras: CameraEntry[];
}

export interface CategoryData {
  key: string;
  label: string;
  events: EventEntry[];
}

export interface TeslaDriveData {
  driveName: string;
  categories: CategoryData[];
}

// ---------------------------------------------------------------------------
// File System Access API — typed iterator wrapper
// TypeScript's built-in DOM types for this project's TS version do not expose
// `entries()` on FileSystemDirectoryHandle.  We model it locally.
// ---------------------------------------------------------------------------
interface FSDirectoryIterable {
  entries(): AsyncIterableIterator<[string, FileSystemHandle & { kind: "file" | "directory" }]>;
}

function iterDir(handle: FileSystemDirectoryHandle): FSDirectoryIterable {
  // Casting through `unknown` is safe here: all modern browsers (Chrome/Edge)
  // that support showDirectoryPicker also implement the iterator protocol.
  return handle as unknown as FSDirectoryIterable;
}

// ---------------------------------------------------------------------------
// Camera metadata
// ---------------------------------------------------------------------------
const CAMERA_ORDER = [
  "front",
  "back",
  "left_repeater",
  "left_pillar",
  "right_repeater",
  "right_pillar",
];

export const CAMERA_LABELS: Record<string, string> = {
  front: "Front",
  back: "Rear",
  left_repeater: "Left Repeater",
  left_pillar: "Left Pillar",
  right_repeater: "Right Repeater",
  right_pillar: "Right Pillar",
};

const SLOT_MAP: Record<string, CameraSlot> = {
  front: "front",
  back: "rear",
  left_repeater: "left",
  left_pillar: "left",
  right_repeater: "right",
  right_pillar: "right",
};

const KNOWN_CAMERA_NAMES = Object.keys(SLOT_MAP);

export function detectCameraFromFilename(
  filename: string
): { cameraName: string; slot: CameraSlot } | null {
  const lower = filename.toLowerCase().replace(/\.mp4$/i, "");

  // Tesla filenames end with -cameraname, e.g. 2026-03-11_11-06-32-front
  for (const cam of KNOWN_CAMERA_NAMES) {
    if (lower === cam || lower.endsWith(`-${cam}`) || lower.endsWith(`_${cam}`)) {
      return { cameraName: cam, slot: SLOT_MAP[cam] };
    }
  }

  // Keyword fallback
  if (lower.includes("front")) return { cameraName: "front", slot: "front" };
  if (lower.includes("left_pillar") || lower.includes("left-pillar"))
    return { cameraName: "left_pillar", slot: "left" };
  if (lower.includes("right_pillar") || lower.includes("right-pillar"))
    return { cameraName: "right_pillar", slot: "right" };
  if (lower.includes("left_repeater") || lower.includes("left-repeater"))
    return { cameraName: "left_repeater", slot: "left" };
  if (lower.includes("right_repeater") || lower.includes("right-repeater"))
    return { cameraName: "right_repeater", slot: "right" };
  if (lower.includes("back") || lower.includes("rear"))
    return { cameraName: "back", slot: "rear" };
  if (lower.includes("left") && !lower.includes("right"))
    return { cameraName: "left_repeater", slot: "left" };
  if (lower.includes("right") && !lower.includes("left"))
    return { cameraName: "right_repeater", slot: "right" };

  return null;
}

// ---------------------------------------------------------------------------
// Directory scanning helpers
// ---------------------------------------------------------------------------

/**
 * Scan one event folder.  An event can contain multiple timestamp segments for
 * each camera (e.g. a long Sentry clip produces several 1-minute MP4s per
 * camera).  We keep only the FIRST file (earliest timestamp, since Tesla file
 * names are timestamp-prefixed and sort alphabetically) per camera name so that
 * the viewer receives exactly one file per camera angle.
 */
async function scanEventDir(
  eventHandle: FileSystemDirectoryHandle
): Promise<CameraEntry[]> {
  const allFiles: Array<{ name: string; handle: FileSystemFileHandle }> = [];

  for await (const [name, handle] of iterDir(eventHandle).entries()) {
    if (handle.kind !== "file") continue;
    if (!name.toLowerCase().endsWith(".mp4")) continue;
    allFiles.push({ name, handle: handle as FileSystemFileHandle });
  }

  // Sort alphabetically → earliest timestamp first
  allFiles.sort((a, b) => a.name.localeCompare(b.name));

  // One entry per camera name — first file wins
  const seen = new Set<string>();
  const cameras: CameraEntry[] = [];
  for (const { name, handle } of allFiles) {
    const detected = detectCameraFromFilename(name);
    if (!detected || seen.has(detected.cameraName)) continue;
    seen.add(detected.cameraName);
    cameras.push({
      cameraName: detected.cameraName,
      label: CAMERA_LABELS[detected.cameraName] ?? detected.cameraName,
      slot: detected.slot,
      fileHandle: handle,
    });
  }

  cameras.sort((a, b) => {
    const ai = CAMERA_ORDER.indexOf(a.cameraName);
    const bi = CAMERA_ORDER.indexOf(b.cameraName);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  return cameras;
}

async function scanCategoryDir(
  categoryHandle: FileSystemDirectoryHandle,
  label: string
): Promise<CategoryData> {
  const events: EventEntry[] = [];

  for await (const [name, handle] of iterDir(categoryHandle).entries()) {
    if (handle.kind !== "directory") continue;
    const cameras = await scanEventDir(handle as FileSystemDirectoryHandle);
    if (cameras.length > 0) events.push({ name, cameras });
  }

  events.sort((a, b) => b.name.localeCompare(a.name));
  return { key: categoryHandle.name, label, events };
}

// ---------------------------------------------------------------------------
// Clip category config
// ---------------------------------------------------------------------------
const CATEGORY_CONFIG: Array<{ key: string; label: string }> = [
  { key: "SavedClips", label: "Saved Clips" },
  { key: "RecentClips", label: "Recent Clips" },
  { key: "SentryClips", label: "Sentry Clips" },
];

const CATEGORY_BY_LOWER = new Map<string, { key: string; label: string }>(
  CATEGORY_CONFIG.map((c) => [c.key.toLowerCase(), c])
);

// ---------------------------------------------------------------------------
// Scan from different root types
// ---------------------------------------------------------------------------
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

async function scanFromTeslaCam(
  teslaCamHandle: FileSystemDirectoryHandle,
  driveName: string
): Promise<TeslaDriveData> {
  // Collect all entries from TeslaCam folder
  const allEntries = new Map<string, FileSystemDirectoryHandle>();
  for await (const [name, handle] of iterDir(teslaCamHandle).entries()) {
    if (handle.kind === "directory") {
      allEntries.set(name, handle as FileSystemDirectoryHandle);
    }
  }

  const categories: CategoryData[] = [];
  for (const { key, label } of CATEGORY_CONFIG) {
    const handle = allEntries.get(key);
    if (!handle) continue;
    const cat = await scanCategoryDir(handle, label);
    if (cat.events.length > 0) categories.push(cat);
  }

  return { driveName, categories };
}

async function scanFromCategory(
  catHandle: FileSystemDirectoryHandle
): Promise<TeslaDriveData> {
  const config =
    CATEGORY_BY_LOWER.get(catHandle.name.toLowerCase()) ??
    { key: catHandle.name, label: catHandle.name };
  const cat = await scanCategoryDir(catHandle, config.label);
  return {
    driveName: catHandle.name,
    categories: cat.events.length > 0 ? [{ ...cat, key: config.key }] : [],
  };
}

async function scanFromEvent(
  eventHandle: FileSystemDirectoryHandle
): Promise<TeslaDriveData> {
  const cameras = await scanEventDir(eventHandle);
  const event: EventEntry = { name: eventHandle.name, cameras };
  return {
    driveName: eventHandle.name,
    categories:
      cameras.length > 0
        ? [{ key: "Event", label: "Event", events: [event] }]
        : [],
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Scan a directory selected by the user.  Supports four starting points:
 *  1. Drive root containing a `TeslaCam` subfolder
 *  2. The `TeslaCam` folder itself
 *  3. A clip-category folder (SavedClips / RecentClips / SentryClips)
 *  4. An individual event folder (timestamp pattern YYYY-MM-DD_HH-MM-SS)
 *
 * Throws if none of these cases match (i.e. no TeslaCam content found).
 */
export async function scanTeslaDrive(
  dirHandle: FileSystemDirectoryHandle
): Promise<TeslaDriveData> {
  const lowerName = dirHandle.name.toLowerCase();

  // Case 2: TeslaCam folder itself
  if (lowerName === "teslacam") {
    return scanFromTeslaCam(dirHandle, dirHandle.name);
  }

  // Case 3: Clip category folder
  if (CATEGORY_BY_LOWER.has(lowerName)) {
    return scanFromCategory(dirHandle);
  }

  // Case 4: Individual event folder
  if (TIMESTAMP_PATTERN.test(dirHandle.name)) {
    return scanFromEvent(dirHandle);
  }

  // Case 1: Drive root — search for TeslaCam subfolder
  for await (const [name, handle] of iterDir(dirHandle).entries()) {
    if (handle.kind === "directory" && name.toLowerCase() === "teslacam") {
      return scanFromTeslaCam(handle as FileSystemDirectoryHandle, dirHandle.name);
    }
  }

  throw new Error(
    "No TeslaCam folder found. Please select your Tesla flash drive, the TeslaCam folder, or a clip category folder (SavedClips, RecentClips, SentryClips)."
  );
}

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

export function detectCameraFromFilename(
  filename: string
): { cameraName: string; slot: CameraSlot } | null {
  const lower = filename.toLowerCase().replace(/\.mp4$/i, "");

  // Tesla filename pattern: YYYY-MM-DD_HH-MM-SS-cameraname
  // or just: cameraname (when the folder name is the timestamp)
  const KNOWN_CAMS = [
    "front",
    "back",
    "left_repeater",
    "left_pillar",
    "right_repeater",
    "right_pillar",
  ];

  for (const cam of KNOWN_CAMS) {
    if (lower === cam || lower.endsWith(`-${cam}`) || lower.endsWith(`_${cam}`)) {
      return { cameraName: cam, slot: SLOT_MAP[cam] };
    }
  }

  // Fallback keyword scan
  if (lower.includes("front")) return { cameraName: "front", slot: "front" };
  if (lower.includes("left_pillar"))
    return { cameraName: "left_pillar", slot: "left" };
  if (lower.includes("right_pillar"))
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

async function scanEventDir(
  eventHandle: FileSystemDirectoryHandle
): Promise<CameraEntry[]> {
  const cameras: CameraEntry[] = [];
  for await (const [name, handle] of (eventHandle as any).entries()) {
    if (handle.kind !== "file") continue;
    if (!name.toLowerCase().endsWith(".mp4")) continue;
    const detected = detectCameraFromFilename(name);
    if (detected) {
      cameras.push({
        cameraName: detected.cameraName,
        label: CAMERA_LABELS[detected.cameraName] ?? detected.cameraName,
        slot: detected.slot,
        fileHandle: handle as FileSystemFileHandle,
      });
    }
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
  for await (const [name, handle] of (categoryHandle as any).entries()) {
    if (handle.kind !== "directory") continue;
    const cameras = await scanEventDir(handle as FileSystemDirectoryHandle);
    if (cameras.length > 0) {
      events.push({ name, cameras });
    }
  }
  events.sort((a, b) => b.name.localeCompare(a.name));
  return { key: categoryHandle.name, label, events };
}

const CLIP_CATEGORIES = [
  { key: "SavedClips", label: "Saved Clips" },
  { key: "RecentClips", label: "Recent Clips" },
  { key: "SentryClips", label: "Sentry Clips" },
];

export async function scanTeslaDrive(
  dirHandle: FileSystemDirectoryHandle
): Promise<TeslaDriveData> {
  let teslaCamHandle: FileSystemDirectoryHandle | null = null;

  if (dirHandle.name.toLowerCase() === "teslacam") {
    teslaCamHandle = dirHandle;
  } else {
    for await (const [name, handle] of (dirHandle as any).entries()) {
      if (handle.kind === "directory" && name.toLowerCase() === "teslacam") {
        teslaCamHandle = handle as FileSystemDirectoryHandle;
        break;
      }
    }
  }

  if (!teslaCamHandle) {
    throw new Error(
      "No TeslaCam folder found. Please select your Tesla flash drive or the TeslaCam folder directly."
    );
  }

  const allEntries = new Map<string, FileSystemDirectoryHandle | FileSystemFileHandle>();
  for await (const [name, handle] of (teslaCamHandle as any).entries()) {
    allEntries.set(name, handle);
  }

  const categories: CategoryData[] = [];
  for (const { key, label } of CLIP_CATEGORIES) {
    const handle = allEntries.get(key);
    if (!handle || handle.kind !== "directory") continue;
    const cat = await scanCategoryDir(handle as FileSystemDirectoryHandle, label);
    if (cat.events.length > 0) {
      categories.push(cat);
    }
  }

  return { driveName: dirHandle.name, categories };
}

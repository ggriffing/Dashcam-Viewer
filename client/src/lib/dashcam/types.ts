declare global {
  interface Window {
    DashcamMP4: typeof DashcamMP4;
    DashcamHelpers: typeof DashcamHelpers;
    protobuf: any;
    JSZip: any;
    showDirectoryPicker?(options?: {
      id?: string;
      mode?: "read" | "readwrite";
      startIn?: string;
    }): Promise<FileSystemDirectoryHandle>;
  }
}

export interface VideoFrame {
  index: number;
  keyframe: boolean;
  data: Uint8Array;
  sei: SeiMetadataRaw | null;
  sps: Uint8Array;
  pps: Uint8Array;
}

export interface VideoConfig {
  width: number;
  height: number;
  codec: string;
  sps: Uint8Array;
  pps: Uint8Array;
  avcC: Uint8Array;
  timescale: number;
  durations: number[];
}

export interface SeiMetadataRaw {
  version?: number;
  gearState?: number;
  frameSeqNo?: number;
  vehicleSpeedMps?: number;
  acceleratorPedalPosition?: number;
  steeringWheelAngle?: number;
  blinkerOnLeft?: boolean;
  blinkerOnRight?: boolean;
  brakeApplied?: boolean;
  autopilotState?: number;
  latitudeDeg?: number;
  longitudeDeg?: number;
  headingDeg?: number;
  linearAccelerationMps2X?: number;
  linearAccelerationMps2Y?: number;
  linearAccelerationMps2Z?: number;
}

export interface FieldInfo {
  propName: string;
  protoName: string;
  label?: string;
  enumMap: any;
}

export declare class DashcamMP4 {
  constructor(buffer: ArrayBuffer);
  buffer: ArrayBuffer;
  view: DataView;
  findBox(start: number, end: number, name: string): { start: number; end: number; size: number };
  findMdat(): { offset: number; size: number };
  getConfig(): VideoConfig;
  parseFrames(SeiMetadata: any): VideoFrame[];
  extractSeiMessages(SeiMetadata: any): SeiMetadataRaw[];
  decodeSei(nal: Uint8Array, SeiMetadata: any): SeiMetadataRaw | null;
  stripEmulationBytes(data: Uint8Array): Uint8Array;
  readAscii(start: number, len: number): string;
  hex(n: number): string;
  static concat(...arrays: Uint8Array[]): Uint8Array;
}

export declare const DashcamHelpers: {
  initProtobuf(protoPath?: string): Promise<{ SeiMetadata: any; enumFields: any }>;
  getProtobuf(): { SeiMetadata: any; enumFields: any } | null;
  deriveFieldInfo(SeiMetadataCtor: any, enumMap: any, options?: { useSnakeCase?: boolean; useLabels?: boolean }): FieldInfo[];
  formatValue(value: any, enumType?: any): string | number;
  buildCsv(messages: SeiMetadataRaw[], fieldInfo: FieldInfo[]): string;
  downloadBlob(blob: Blob, filename: string): void;
  getFilesFromDataTransfer(items: DataTransferItemList): Promise<{ files: File[]; directoryName: string | null }>;
};

export type CameraAngle = "front" | "left" | "right" | "rear";

export interface CameraVideo {
  angle: CameraAngle;
  file: File;
  mp4: DashcamMP4 | null;
  frames: VideoFrame[];
  config: VideoConfig | null;
  canvas: HTMLCanvasElement | null;
  decoder: VideoDecoder | null;
}

export interface PlaybackState {
  isPlaying: boolean;
  currentFrame: number;
  totalFrames: number;
  currentTime: number;
  duration: number;
}

export {};

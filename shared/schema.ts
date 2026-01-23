import { z } from "zod";

export const cameraAngleSchema = z.enum(["front", "left", "right", "rear"]);
export type CameraAngle = z.infer<typeof cameraAngleSchema>;

export const gearStateSchema = z.enum(["GEAR_PARK", "GEAR_DRIVE", "GEAR_REVERSE", "GEAR_NEUTRAL"]);
export type GearState = z.infer<typeof gearStateSchema>;

export const autopilotStateSchema = z.enum(["NONE", "SELF_DRIVING", "AUTOSTEER", "TACC"]);
export type AutopilotState = z.infer<typeof autopilotStateSchema>;

export const seiMetadataSchema = z.object({
  version: z.number().optional(),
  gearState: gearStateSchema.optional(),
  frameSeqNo: z.number().optional(),
  vehicleSpeedMps: z.number().optional(),
  acceleratorPedalPosition: z.number().optional(),
  steeringWheelAngle: z.number().optional(),
  blinkerOnLeft: z.boolean().optional(),
  blinkerOnRight: z.boolean().optional(),
  brakeApplied: z.boolean().optional(),
  autopilotState: autopilotStateSchema.optional(),
  latitudeDeg: z.number().optional(),
  longitudeDeg: z.number().optional(),
  headingDeg: z.number().optional(),
  linearAccelerationMps2X: z.number().optional(),
  linearAccelerationMps2Y: z.number().optional(),
  linearAccelerationMps2Z: z.number().optional(),
});
export type SeiMetadata = z.infer<typeof seiMetadataSchema>;

export const videoFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  angle: cameraAngleSchema,
  size: z.number(),
  url: z.string().optional(),
});
export type VideoFile = z.infer<typeof videoFileSchema>;

export const dashcamSessionSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  files: z.array(videoFileSchema),
  duration: z.number().optional(),
});
export type DashcamSession = z.infer<typeof dashcamSessionSchema>;

export const playbackStateSchema = z.object({
  isPlaying: z.boolean(),
  currentTime: z.number(),
  duration: z.number(),
  currentFrame: z.number(),
  totalFrames: z.number(),
});
export type PlaybackState = z.infer<typeof playbackStateSchema>;

export interface TelemetryData {
  speed: number;
  speedUnit: "mph" | "km/h";
  gear: GearState;
  autopilot: AutopilotState;
  latitude: number;
  longitude: number;
  heading: number;
  steeringAngle: number;
  accelerator: number;
  brakeApplied: boolean;
  blinkerLeft: boolean;
  blinkerRight: boolean;
  timestamp: string;
  frameNumber: number;
}

export const users = {
  id: "",
  username: "",
  password: "",
};

export type InsertUser = {
  username: string;
  password: string;
};

export type User = {
  id: string;
  username: string;
  password: string;
};

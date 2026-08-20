import { z } from "zod";
import { json, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

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

export const users = pgTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
  username: varchar("username", { length: 32 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("session", {
  sid: varchar("sid", { length: 255 }).primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { withTimezone: true }).notNull(),
});

export type InsertUser = {
  username: string;
  password: string;
};

export type User = Pick<typeof users.$inferSelect, "id" | "username">;
export type StoredUser = typeof users.$inferSelect;

export const authCredentialsSchema = z.object({
  username: z
    .string({ required_error: "Username is required" })
    .trim()
    .min(1, "Username is required")
    .max(32, "Username is too long"),
  password: z
    .string({ required_error: "Password is required" })
    .min(1, "Password is required")
    .max(128, "Password is too long"),
});

export const signUpSchema = authCredentialsSchema.extend({
  username: z
    .string({ required_error: "Username is required" })
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(32, "Username must be 32 characters or fewer")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only use letters, numbers, and underscores"),
  password: z
    .string({ required_error: "Password is required" })
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be 128 characters or fewer"),
});

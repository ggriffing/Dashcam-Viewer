import type { SeiMetadataRaw } from "./types";

/**
 * Returns the accelerator pedal value used by the on-screen telemetry.
 *
 * Tesla SEI payloads normally expose this as a fraction from 0 to 1. Some
 * recordings/tools represent the same value as a percentage, so values above
 * 1 are treated as percentage values for a consistent display.
 */
export function getDisplayedAccelFraction(
  metadata: SeiMetadataRaw | null | undefined,
): number {
  const pedal = metadata?.acceleratorPedalPosition;
  if (pedal === undefined || !Number.isFinite(pedal)) return 0;

  const fraction = pedal > 1 ? pedal / 100 : pedal;
  return Math.max(0, Math.min(1, fraction));
}
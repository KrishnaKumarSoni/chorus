import type { Capability } from '../../shared/types';

export const IMAGE_TOKENS = 1600;
const CHARS_PER_TOKEN = 4;
const SAFETY_FRACTION = 0.8;
const DEFAULT_OUTPUT_RESERVE = 16_000;
const MAX_OUTPUT_RESERVE = 32_000;

export function estimateTextTokens(text: string, calibration = 1): number {
  if (!text) return 0;
  return Math.ceil((text.length / CHARS_PER_TOKEN) * calibration);
}

export function estimateImageTokens(count: number): number {
  return count * IMAGE_TOKENS;
}

/** Usable input budget for one request against a discovered context window. */
export function computeBudget(cap: Pick<Capability, 'contextWindow' | 'maxOutputTokens'>): number {
  const reserve = Math.min(cap.maxOutputTokens ?? DEFAULT_OUTPUT_RESERVE, MAX_OUTPUT_RESERVE);
  return Math.max(1_000, Math.floor(cap.contextWindow * SAFETY_FRACTION) - reserve);
}

/** Update calibration from an observed request: actual tokens vs our estimate. Clamped, smoothed. */
export function recalibrate(previous: number, estimated: number, actual: number): number {
  if (estimated <= 0 || actual <= 0) return previous;
  const observed = actual / estimated;
  const clamped = Math.min(2, Math.max(0.5, observed));
  // exponential moving average so a single odd request cannot swing the estimate
  return Math.round((previous * 0.7 + clamped * 0.3) * 1000) / 1000;
}

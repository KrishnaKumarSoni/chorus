import { describe, it, expect } from 'vitest';
import { estimateTextTokens, computeBudget, recalibrate, IMAGE_TOKENS, estimateImageTokens } from './tokens';

describe('tokens', () => {
  it('estimates ~4 chars per token and rounds up', () => {
    expect(estimateTextTokens('')).toBe(0);
    expect(estimateTextTokens('abcd')).toBe(1);
    expect(estimateTextTokens('abcde')).toBe(2);
    expect(estimateTextTokens('a'.repeat(400), 1.5)).toBe(150);
  });
  it('counts images at a flat rate', () => {
    expect(estimateImageTokens(2)).toBe(2 * IMAGE_TOKENS);
  });
  it('derives budget from the context window without hard-coding a model', () => {
    expect(computeBudget({ contextWindow: 200_000 })).toBe(160_000 - 16_000);
    expect(computeBudget({ contextWindow: 1_000_000, maxOutputTokens: 128_000 })).toBe(800_000 - 32_000);
    expect(computeBudget({ contextWindow: 10_000 })).toBe(1_000);
  });
  it('recalibrates gently and within bounds', () => {
    expect(recalibrate(1, 100, 100)).toBe(1);
    expect(recalibrate(1, 100, 1000)).toBe(1.3);
    expect(recalibrate(1, 100, 10)).toBe(0.85);
    expect(recalibrate(1, 0, 10)).toBe(1);
  });
});

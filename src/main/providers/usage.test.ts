import { describe, expect, it } from 'vitest';
import { perReplyUsage } from './codex';
import { claudeReplyUsage } from './claude';

describe('per-reply token usage', () => {
  it('turns Codex running totals into per-reply usage', () => {
    // Real totals from a Chorus thread: 108,927 then 202,452 input.
    const first = { input: 108927, output: 3831, cachedInput: 85504 };
    const second = { input: 202452, output: 9933, cachedInput: 165376 };
    expect(perReplyUsage(first)).toEqual(first);
    expect(perReplyUsage(second, first)).toEqual({ input: 93525, output: 6102, cachedInput: 79872 });
    // A new thread (totals reset) is taken as-is.
    expect(perReplyUsage({ input: 500, output: 10, cachedInput: 0 }, second)).toEqual({ input: 500, output: 10, cachedInput: 0 });
  });

  it('counts Claude uncached, cache-read and cache-write input together', () => {
    expect(claudeReplyUsage({ input_tokens: 12, output_tokens: 900, cache_read_input_tokens: 20000, cache_creation_input_tokens: 3000 }))
      .toEqual({ input: 23012, output: 900, cachedInput: 20000 });
  });
});

import { describe, expect, it } from 'vitest';
import { claudeWindows, codexWindows, windowLabel } from './limits';

describe('usage limits', () => {
  it('labels Codex windows by their length', () => {
    expect(windowLabel(300, 'Session')).toBe('5-hour session');
    expect(windowLabel(10080, 'Weekly')).toBe('Weekly');
    const w = codexWindows({ primary: { usedPercent: 61, windowDurationMins: 300, resetsAt: 1790320414 }, secondary: { usedPercent: 92, windowDurationMins: 10080 } });
    expect(w).toEqual([
      { label: '5-hour session', usedPercent: 61, resetsAt: new Date(1790320414 * 1000).toISOString(), severity: 'normal' },
      { label: 'Weekly', usedPercent: 92, resetsAt: undefined, severity: 'critical' },
    ]);
  });

  it('prefers the server rows Claude sends, and falls back to fixed windows', () => {
    const rows = claudeWindows({
      limits: [
        { kind: 'session', percent: 20, severity: 'normal', resets_at: '2026-09-25T10:50:00Z', scope: null },
        { kind: 'weekly_scoped', percent: 80, severity: 'warning', resets_at: null, scope: { model: { display_name: 'Opus' } } },
      ],
    });
    expect(rows.map((r) => [r.label, r.usedPercent, r.severity])).toEqual([['5-hour session', 20, 'normal'], ['Weekly · Opus', 80, 'warning']]);
    const fixed = claudeWindows({ limits: null, five_hour: { utilization: 20, resets_at: null }, seven_day: { utilization: 25, resets_at: 'x' } });
    expect(fixed.map((r) => r.label)).toEqual(['5-hour session', 'Weekly']);
  });
});

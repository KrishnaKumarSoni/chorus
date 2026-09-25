import type { LimitWindow } from '../../shared/types';

/** Label a usage window by its length, the way both providers' own apps do. */
export function windowLabel(minutes: number | undefined, fallback: string): string {
  if (!minutes) return fallback;
  if (minutes === 10080) return 'Weekly';
  if (minutes % 1440 === 0) return `${minutes / 1440}-day`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour session`;
  return `${minutes}-minute window`;
}

export function severityFor(usedPercent: number): LimitWindow['severity'] {
  if (usedPercent >= 90) return 'critical';
  if (usedPercent >= 75) return 'warning';
  return 'normal';
}

interface ClaudeRow {
  kind: string;
  percent: number;
  severity?: string;
  resets_at: string | null;
  scope?: { model?: { display_name: string } | null; surface?: { display_name: string } | null } | null;
}

interface ClaudeWindow {
  utilization: number | null;
  resets_at: string | null;
}

/** Map the Claude usage reply (server rows first, fixed windows as a fallback) to display windows. */
export function claudeWindows(rateLimits: { limits?: ClaudeRow[] | null; five_hour?: ClaudeWindow | null; seven_day?: ClaudeWindow | null } | null): LimitWindow[] {
  if (!rateLimits) return [];
  if (rateLimits.limits?.length) {
    return rateLimits.limits.map((r) => {
      const scope = r.scope?.model?.display_name ?? r.scope?.surface?.display_name;
      const label = r.kind === 'session' ? '5-hour session' : r.kind === 'weekly_all' ? 'Weekly' : scope ? `Weekly · ${scope}` : r.kind.replace(/_/g, ' ');
      const severity = r.severity === 'warning' || r.severity === 'critical' ? r.severity : severityFor(r.percent);
      return { label, usedPercent: r.percent, resetsAt: r.resets_at ?? undefined, severity };
    });
  }
  const out: LimitWindow[] = [];
  const add = (label: string, w?: ClaudeWindow | null) => {
    if (w?.utilization == null) return;
    out.push({ label, usedPercent: w.utilization, resetsAt: w.resets_at ?? undefined, severity: severityFor(w.utilization) });
  };
  add('5-hour session', rateLimits.five_hour);
  add('Weekly', rateLimits.seven_day);
  return out;
}

interface CodexWindow {
  usedPercent: number;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
}

/** Map a Codex `account/rateLimits/read` snapshot to display windows. */
export function codexWindows(snapshot: { primary?: CodexWindow | null; secondary?: CodexWindow | null } | null | undefined): LimitWindow[] {
  if (!snapshot) return [];
  const out: LimitWindow[] = [];
  for (const [w, fallback] of [[snapshot.primary, 'Session'], [snapshot.secondary, 'Weekly']] as const) {
    if (!w) continue;
    out.push({
      label: windowLabel(w.windowDurationMins ?? undefined, fallback),
      usedPercent: w.usedPercent,
      resetsAt: w.resetsAt ? new Date(w.resetsAt * 1000).toISOString() : undefined,
      severity: severityFor(w.usedPercent),
    });
  }
  return out;
}

import React, { useEffect, useState } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { useChorus } from '../lib/state';
import type { LimitWindow, Provider } from '../../shared/types';

const NAME: Record<Provider, string> = { claude: 'Claude', codex: 'ChatGPT' };
const SEVERITY_COLOR = { normal: undefined, warning: 'var(--warning)', critical: 'var(--danger)' } as const;

/** Plan usage left for each provider: the fill is what remains, so a full bar means plenty. */
export function UsagePanel() {
  const { limits, limitsLoading, refreshLimits, statuses } = useChorus();
  const now = useNow(30_000);
  const checked = limits[0]?.checkedAt;
  return (
    <section aria-labelledby="usage-title" aria-busy={limitsLoading}>
      <div className="flex items-center justify-between">
        <h2 id="usage-title" className="eyebrow">Usage left</h2>
        <button className="btn btn-ghost btn-icon" onClick={() => refreshLimits()} disabled={limitsLoading} aria-label="Refresh usage" title={checked ? `Updated ${ago(checked, now)}` : 'Refresh usage'}>
          <ArrowsClockwise size={14} className={limitsLoading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="mt-1 flex flex-col gap-4">
        {(['claude', 'codex'] as Provider[]).map((p) => {
          const l = limits.find((x) => x.provider === p);
          const signedOut = statuses.find((s) => s.provider === p)?.ok === false;
          return (
            <div key={p}>
              <div className="flex items-center gap-2 text-meta">
                <span className="h-2 w-2 rounded-full" style={{ background: `var(--${p})` }} aria-hidden />
                <span className="font-semibold">{NAME[p]}</span>
                {l?.plan && <span className="rounded-full px-1.5 text-caption font-medium" style={{ background: 'var(--fill-strong)', color: 'var(--ink-2)' }}>{l.plan}</span>}
              </div>
              {!l ? (
                <div className="mt-2 flex flex-col gap-2" aria-hidden><div className="shimmer h-1.5" /><div className="shimmer h-1.5 w-2/3" /></div>
              ) : l.windows.length ? (
                <ul className="mt-2 flex flex-col gap-2.5">
                  {l.windows.map((w) => <Meter key={w.label} w={w} provider={p} now={now} />)}
                </ul>
              ) : (
                <p className="hint mt-1">{signedOut ? 'Sign in from Settings to see what is left.' : l.note}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Meter({ w, provider, now }: { w: LimitWindow; provider: Provider; now: number }) {
  const left = Math.max(0, Math.min(100, 100 - w.usedPercent));
  const color = SEVERITY_COLOR[w.severity ?? 'normal'] ?? `var(--${provider})`;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-caption">
        <span style={{ color: 'var(--ink-2)' }}>{w.label}</span>
        <span className="tabular font-semibold" style={{ color: w.severity && w.severity !== 'normal' ? color : 'var(--ink)' }}>{Math.round(left)}% left</span>
      </div>
      <div className="meter mt-1" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(left)} aria-label={`${w.label}: ${Math.round(left)}% left`}>
        <span style={{ background: color, scale: `${left / 100} 1` }} />
      </div>
      {w.resetsAt && <p className="mt-1 text-caption tabular" style={{ color: 'var(--muted)' }}>{resets(w.resetsAt, now)}</p>}
    </li>
  );
}

function useNow(every: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

function resets(iso: string, now: number): string {
  const at = new Date(iso);
  const mins = Math.round((at.getTime() - now) / 60000);
  if (mins <= 0) return 'Resets now';
  if (mins < 60) return `Resets in ${mins} min`;
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `Resets in ${h} hr${m ? ` ${m} min` : ''}`;
  }
  return `Resets ${at.toLocaleDateString(undefined, { weekday: 'short' })} ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

function ago(iso: string, now: number): string {
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m === 1 ? '1 minute ago' : `${m} minutes ago`;
}

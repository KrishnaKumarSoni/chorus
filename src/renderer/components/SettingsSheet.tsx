import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, ArrowsClockwise } from '@phosphor-icons/react';
import { useChorus } from '../lib/state';
import type { Effort, Mode, Provider, Settings } from '../../shared/types';
import { settle } from '../lib/motion';

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const EFFORT_LABEL: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
const PROVIDER_LABEL: Record<Provider, string> = { claude: 'Claude', codex: 'GPT via Codex' };

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { settings, statuses, saveSettings, refreshStatus } = useChorus();
  const [draft, setDraft] = useState<Settings | undefined>(settings);
  const [refreshing, setRefreshing] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    return () => opener?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!draft) return null;

  const commit = (patch: Partial<Settings>) => {
    const next = { ...draft, ...patch, models: { ...draft.models, ...(patch.models ?? {}) }, effort: { ...draft.effort, ...(patch.effort ?? {}) } };
    setDraft(next);
    saveSettings(patch);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: 'var(--scrim)' }} onClick={onClose}>
      <motion.div role="dialog" aria-modal="true" aria-label="Settings" initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 8 }} transition={settle}
        className="surface scroll max-h-[86vh] w-[640px] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h1 className="display text-heading font-semibold">Settings</h1>
          <button ref={closeBtn} className="btn btn-ghost p-1.5" onClick={onClose} aria-label="Close settings"><X size={16} weight="bold" /></button>
        </div>

        <section className="mt-5">
          <label className="label" htmlFor="global">Global instructions</label>
          <textarea id="global" className="field selectable min-h-[120px] text-ui" defaultValue={draft.globalInstructions}
            onBlur={(e) => { if (e.target.value !== draft.globalInstructions) commit({ globalInstructions: e.target.value }); }}
            placeholder={'I am a product manager.\nPrefer concise answers.\nChallenge assumptions.\nExplain unfamiliar financial terminology.'} />
          <p className="hint mt-1.5">Sent above the conversation to both providers, in every mode.</p>
        </section>

        <section className="mt-6 grid gap-5" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {(['claude', 'codex'] as Provider[]).map((p) => {
            const st = statuses.find((s) => s.provider === p);
            const models = st?.models ?? [];
            const chosen = models.find((m) => m.id === draft.models[p]);
            const efforts = chosen?.efforts?.length ? chosen.efforts : EFFORTS;
            return (
              <div key={p} className="rounded-[12px] border p-4" style={{ borderColor: 'var(--line)' }}>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: `var(--${p})` }} />
                  <span className="font-semibold">{PROVIDER_LABEL[p]}</span>
                  <span className="ml-auto text-caption font-semibold" style={{ color: st?.ok ? 'var(--accent)' : 'var(--danger)' }}>{st ? (st.ok ? 'Ready' : 'Needs sign-in') : 'Checking'}</span>
                </div>
                <p className="hint mt-1 min-h-[32px]">{st?.detail ?? 'Checking…'}</p>
                <label className="label mt-3" htmlFor={`model-${p}`}>Model</label>
                {models.length ? (
                  <select id={`model-${p}`} className="field" value={draft.models[p]} onChange={(e) => commit({ models: { [p]: e.target.value } as Settings['models'] })}>
                    {models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.contextWindow ? ` · ${Math.round(m.contextWindow / 1000)}k` : ''}</option>)}
                  </select>
                ) : (
                  <input id={`model-${p}`} className="field mono" value={draft.models[p]} onChange={(e) => commit({ models: { [p]: e.target.value } as Settings['models'] })} placeholder="model id" />
                )}
                <label className="label mt-3" htmlFor={`effort-${p}`}>Effort</label>
                <select id={`effort-${p}`} className="field" value={draft.effort[p]} onChange={(e) => commit({ effort: { [p]: e.target.value as Effort } as Settings['effort'] })}>
                  {efforts.map((e) => <option key={e} value={e}>{EFFORT_LABEL[e]}</option>)}
                </select>
              </div>
            );
          })}
        </section>

        <section className="mt-6 grid gap-5" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <div>
            <label className="label" htmlFor="default-mode">Default mode</label>
            <select id="default-mode" className="field" value={draft.defaultMode} onChange={(e) => commit({ defaultMode: e.target.value as Mode })}>
              <option value="solo">Solo</option><option value="compare">Compare</option><option value="consensus">Consensus</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="solo-provider">Solo provider</label>
            <select id="solo-provider" className="field" value={draft.soloProvider} onChange={(e) => commit({ soloProvider: e.target.value as Provider })}>
              <option value="claude">Claude</option><option value="codex">GPT via Codex</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="chair">Consensus chair</label>
            <select id="chair" className="field" value={draft.consensusChair} onChange={(e) => commit({ consensusChair: e.target.value as Provider })}>
              <option value="claude">Claude</option><option value="codex">GPT via Codex</option>
            </select>
            <p className="hint mt-1">Writes the final synthesis.</p>
          </div>
        </section>

        <div className="mt-6 flex items-center justify-between">
          <button className="btn text-meta" disabled={refreshing} onClick={async () => { setRefreshing(true); try { await refreshStatus(); } finally { setRefreshing(false); } }}>
            <ArrowsClockwise size={14} className={refreshing ? 'animate-spin' : ''} /> Re-check providers
          </button>
          <p className="hint">Signed-in via the Claude Code and Codex CLIs. No keys are stored here.</p>
        </div>
      </motion.div>
    </motion.div>
  );
}

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, ArrowsClockwise } from '@phosphor-icons/react';
import { useChorus } from '../lib/state';
import type { Effort, Mode, Provider, Settings } from '../../shared/types';
import { settle } from '../lib/motion';

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { settings, statuses, saveSettings, refreshStatus } = useChorus();
  const [draft, setDraft] = useState<Settings | undefined>(settings);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.28)' }} onClick={onClose}>
      <motion.div role="dialog" aria-label="Settings" initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 8 }} transition={settle}
        className="surface scroll max-h-[86vh] w-[640px] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h1 className="display text-[18px] font-semibold">Settings</h1>
          <button className="btn btn-ghost p-1.5" onClick={onClose} aria-label="Close"><X size={16} weight="bold" /></button>
        </div>

        <section className="mt-5">
          <label className="label" htmlFor="global">Global instructions</label>
          <textarea id="global" className="field selectable min-h-[120px] text-[13px]" defaultValue={draft.globalInstructions}
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
                  <span className="font-semibold">{p === 'claude' ? 'Claude' : 'GPT via Codex'}</span>
                  <span className="ml-auto h-2 w-2 rounded-full" style={{ background: st?.ok ? 'var(--accent)' : 'var(--danger)' }} title={st?.detail} />
                </div>
                <p className="hint mt-1 min-h-[32px]">{st?.detail ?? 'Checking…'}</p>
                <label className="label mt-3">Model</label>
                {models.length ? (
                  <select className="field" value={draft.models[p]} onChange={(e) => commit({ models: { [p]: e.target.value } as Settings['models'] })}>
                    {models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.contextWindow ? ` · ${Math.round(m.contextWindow / 1000)}k` : ''}</option>)}
                  </select>
                ) : (
                  <input className="field mono" value={draft.models[p]} onChange={(e) => commit({ models: { [p]: e.target.value } as Settings['models'] })} placeholder="model id" />
                )}
                <label className="label mt-3">Effort</label>
                <select className="field" value={draft.effort[p]} onChange={(e) => commit({ effort: { [p]: e.target.value as Effort } as Settings['effort'] })}>
                  {efforts.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
            );
          })}
        </section>

        <section className="mt-6 grid gap-5" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <div>
            <label className="label">Default mode</label>
            <select className="field" value={draft.defaultMode} onChange={(e) => commit({ defaultMode: e.target.value as Mode })}>
              <option value="solo">Solo</option><option value="compare">Compare</option><option value="consensus">Consensus</option>
            </select>
          </div>
          <div>
            <label className="label">Solo model</label>
            <select className="field" value={draft.soloProvider} onChange={(e) => commit({ soloProvider: e.target.value as Provider })}>
              <option value="claude">Claude</option><option value="codex">GPT</option>
            </select>
          </div>
          <div>
            <label className="label">Consensus chair</label>
            <select className="field" value={draft.consensusChair} onChange={(e) => commit({ consensusChair: e.target.value as Provider })}>
              <option value="claude">Claude</option><option value="codex">GPT</option>
            </select>
            <p className="hint mt-1">Writes the final synthesis.</p>
          </div>
        </section>

        <div className="mt-6 flex items-center justify-between">
          <button className="btn text-[12.5px]" disabled={refreshing} onClick={async () => { setRefreshing(true); try { await refreshStatus(); } finally { setRefreshing(false); } }}>
            <ArrowsClockwise size={14} className={refreshing ? 'animate-spin' : ''} /> Re-check providers
          </button>
          <p className="hint">Signed-in via the Claude Code and Codex CLIs. No keys are stored here.</p>
        </div>
      </motion.div>
    </motion.div>
  );
}

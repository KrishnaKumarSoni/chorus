import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus } from '@phosphor-icons/react';
import { filesToSources, useChorus } from '../lib/state';
import { AttachmentChip } from './AttachmentChip';
import { settle } from '../lib/motion';
import type { Provider } from '../../shared/types';

export function ContextPanel() {
  const { current, setInstructions, addReferences, removeReference, settings, statuses, toast } = useChorus();
  const [text, setText] = useState(current?.instructions ?? '');
  const [dragging, setDragging] = useState(false);
  useEffect(() => setText(current?.instructions ?? ''), [current?.id, current?.instructions]);

  if (!current) return <aside style={{ background: 'var(--context-bg)', borderLeft: '1px solid var(--line)' }} />;

  const add = async (sources: Awaited<ReturnType<typeof filesToSources>>) => {
    if (!sources.length) return;
    try { await addReferences(sources); } catch (e) { toast((e as Error).message, 'error'); }
  };

  return (
    <aside className="flex min-h-0 flex-col" style={{ background: 'var(--context-bg)', borderLeft: '1px solid var(--line)' }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={async (e) => { e.preventDefault(); setDragging(false); add(await filesToSources([...e.dataTransfer.files])); }}>
      <div className="drag-region h-[42px]" />
      <div className="scroll min-h-0 flex-1 px-4 pb-4">
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--muted)' }}>Context</h2>
            <button className="btn btn-ghost no-drag p-1" aria-label="Add reference files" onClick={async () => add(await window.chorus.attachments.pickFiles())}><Plus size={14} weight="bold" /></button>
          </div>
          <p className="hint mt-1">Files every turn can use, for both models, until removed.</p>
          <div className="mt-2 flex flex-col gap-1.5 rounded-[10px] p-1.5" style={{ outline: dragging ? '2px dashed var(--accent)' : 'none', minHeight: 44 }}>
            <AnimatePresence initial={false}>
              {current.references.map((r) => <AttachmentChip key={r.id} att={r} onRemove={() => removeReference(r.id)} />)}
            </AnimatePresence>
            {current.references.length === 0 && <p className="hint px-1 py-2">Drop PDFs, docs, sheets, code or images here.</p>}
          </div>
        </section>

        <section className="mt-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--muted)' }}>Instructions for this chat</h2>
          <textarea className="field selectable mt-2 min-h-[96px] text-[12.5px]" value={text} onChange={(e) => setText(e.target.value)}
            onBlur={() => { if (text !== current.instructions) setInstructions(text); }} placeholder="e.g. Assume I am presenting this to a fintech PM." />
          {settings?.globalInstructions ? <p className="hint mt-1.5">Applied after your global instructions.</p> : <p className="hint mt-1.5">No global instructions set. Add them in Settings.</p>}
        </section>

        <section className="mt-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--muted)' }}>Sessions</h2>
          <div className="mt-2 flex flex-col divide-y" style={{ borderColor: 'var(--line)' }}>
            {(['claude', 'codex'] as Provider[]).map((p) => {
              const s = current.sessions[p];
              const st = statuses.find((x) => x.provider === p);
              const model = settings?.models[p];
              const cw = st?.models.find((m) => m.id === model)?.contextWindow;
              return (
                <motion.div layout transition={settle} key={p} className="py-2 text-[12px]">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: `var(--${p})` }} />
                    <span className="font-semibold">{p === 'claude' ? 'Claude' : 'GPT via Codex'}</span>
                    <span className="mono ml-auto truncate" style={{ color: 'var(--muted)' }}>{model || 'no model'}</span>
                  </div>
                  <p className="mono mt-1 pl-4" style={{ color: 'var(--muted)' }}>
                    {s ? `${s.stale ? 'stale · ' : ''}seen ${s.seenTurnIds.length} turns` : 'no session yet'}{cw ? ` · ${Math.round(cw / 1000)}k window` : ''}
                  </p>
                  {st && !st.ok && <p className="mt-1 pl-4" style={{ color: 'var(--danger)' }}>{st.detail}</p>}
                </motion.div>
              );
            })}
          </div>
          {current.compactions.length > 0 && (
            <p className="hint mono mt-2">{current.compactions.length} compaction{current.compactions.length > 1 ? 's' : ''} · last through turn {current.compactions[current.compactions.length - 1].throughTurnIndex + 1}</p>
          )}
        </section>
      </div>
    </aside>
  );
}

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus } from '@phosphor-icons/react';
import { filesToSources, useChorus } from '../lib/state';
import { AttachmentChip } from './AttachmentChip';
import { UsagePanel } from './UsagePanel';
import { settle } from '../lib/motion';
import type { Provider } from '../../shared/types';

export function ContextPanel() {
  const { current, setInstructions, addReferences, removeReference, settings, statuses, toast, setSettingsOpen } = useChorus();
  const [text, setText] = useState(current?.instructions ?? '');
  const [dragging, setDragging] = useState(false);
  useEffect(() => setText(current?.instructions ?? ''), [current?.id, current?.instructions]);

  if (!current) {
    return (
      <aside aria-label="Usage" className="flex min-h-0 flex-col justify-end" style={{ background: 'var(--context-bg)', boxShadow: 'inset 1px 0 0 var(--line)' }}>
        <div className="drag-region h-[42px] shrink-0" />
        <div className="px-4 pt-3 pb-4"><UsagePanel /></div>
      </aside>
    );
  }

  const add = async (sources: Awaited<ReturnType<typeof filesToSources>>) => {
    if (!sources.length) return;
    try { await addReferences(sources); } catch (e) { toast((e as Error).message, 'error'); }
  };

  return (
    <aside aria-label="Conversation details" className="flex min-h-0 flex-col" style={{ background: 'var(--context-bg)', boxShadow: 'inset 1px 0 0 var(--line)' }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={async (e) => { e.preventDefault(); setDragging(false); add(await filesToSources([...e.dataTransfer.files])); }}>
      <div className="drag-region h-[42px] shrink-0" />
      <div className="scroll min-h-0 flex-1 px-4 pb-4">
        <section>
          <div className="flex items-center justify-between">
            <h2 id="ctx-files" className="eyebrow">Reference files</h2>
            <button className="btn btn-ghost btn-icon no-drag" aria-label="Add reference files" title="Add reference files" onClick={async () => add(await window.chorus.attachments.pickFiles())}><Plus size={14} weight="bold" /></button>
          </div>
          <p className="hint mt-0.5">Both models can read these on every turn until you remove them.</p>
          <div className="mt-2 flex flex-col gap-1.5 rounded-[10px] p-1.5" style={{ outline: dragging ? '2px dashed var(--accent)' : 'none', minHeight: 44 }}>
            <AnimatePresence initial={false}>
              {current.references.map((r) => <AttachmentChip key={r.id} att={r} onRemove={() => removeReference(r.id)} />)}
            </AnimatePresence>
            {current.references.length === 0 && <p className="hint rounded-[8px] px-2.5 py-3 text-center" style={{ boxShadow: 'inset 0 0 0 1px var(--line-strong)' }}>Drop PDFs, documents, sheets, code or images here</p>}
          </div>
        </section>

        <section className="mt-5">
          <h2 id="ctx-instructions" className="eyebrow">Instructions for this chat</h2>
          <textarea aria-labelledby="ctx-instructions" className="field field-grow selectable mt-2 min-h-[96px] text-meta" value={text} onChange={(e) => setText(e.target.value)}
            onBlur={() => { if (text !== current.instructions) setInstructions(text); }} placeholder="For example: I am presenting this to a fintech PM." />
          {settings?.globalInstructions
            ? <p className="hint mt-1.5">Applied after your instructions for every conversation.</p>
            : <p className="hint mt-1.5">To set instructions for every conversation, <button className="underline decoration-dotted underline-offset-2" style={{ color: 'var(--accent)' }} onClick={() => setSettingsOpen(true)}>open Settings</button>.</p>}
        </section>

        <section className="mt-5">
          <h2 className="eyebrow">Sessions</h2>
          <div className="mt-1 flex flex-col">
            {(['claude', 'codex'] as Provider[]).map((p) => {
              const s = current.sessions[p];
              const st = statuses.find((x) => x.provider === p);
              const model = settings?.models[p];
              const cw = st?.models.find((m) => m.id === model)?.contextWindow;
              return (
                <motion.div layout transition={settle} key={p} className="py-2 text-meta" style={{ boxShadow: p === 'codex' ? 'inset 0 1px 0 var(--line)' : undefined }}>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: `var(--${p})` }} />
                    <span className="font-semibold">{p === 'claude' ? 'Claude' : 'ChatGPT'}</span>
                    <span className="mono ml-auto truncate" style={{ color: 'var(--muted)' }} title={model}>{model || 'No model chosen'}</span>
                  </div>
                  <p className="mt-0.5 pl-4 text-caption tabular" style={{ color: 'var(--muted)' }}>
                    {s ? `${s.stale ? 'Stale · ' : ''}Seen ${s.seenTurnIds.length} turns` : 'No session yet'}{cw ? ` · ${Math.round(cw / 1000)}k window` : ''}
                  </p>
                  {st && !st.ok && <p className="selectable mt-1 pl-4" style={{ color: 'var(--danger)' }}>{st.detail}</p>}
                </motion.div>
              );
            })}
          </div>
          {current.compactions.length > 0 && (
            <p className="hint mono mt-2">{current.compactions.length} compaction{current.compactions.length > 1 ? 's' : ''} · last through turn {current.compactions[current.compactions.length - 1].throughTurnIndex + 1}</p>
          )}
        </section>
      </div>
      <div className="shrink-0 px-4 pt-3 pb-4" style={{ boxShadow: 'inset 0 1px 0 var(--line)' }}>
        <UsagePanel />
      </div>
    </aside>
  );
}

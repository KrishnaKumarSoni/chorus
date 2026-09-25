import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Paperclip, ArrowUp, Stop } from '@phosphor-icons/react';
import { filesToSources, useChorus } from '../lib/state';
import { ModeSwitch } from './ModeSwitch';
import { AttachmentChip } from './AttachmentChip';
import type { Attachment, Mode, Provider } from '../../shared/types';
import { settle } from '../lib/motion';
import { turnOptions } from '../lib/turns';
import { Select } from './ui/Select';
import { Segmented } from './ui/Segmented';

export function Composer() {
  const { current, settings, busy, send, cancel, saveSettings, toast } = useChorus();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>(current?.mode ?? settings?.defaultMode ?? 'solo');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setMode(current?.mode ?? settings?.defaultMode ?? 'solo'); setAttachments([]); setText(''); }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(220, el.scrollHeight)}px`;
  }, [text]);

  const ingest = async (files: File[]) => {
    if (!files.length) return;
    setIngesting(true);
    try {
      const atts = await window.chorus.attachments.ingest(await filesToSources(files));
      setAttachments((a) => [...a, ...atts]);
      for (const a of atts) if (a.extractError) toast(`${a.name}: could not extract text (${a.extractError})`, 'error');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setIngesting(false);
    }
  };

  const pick = async () => {
    const sources = await window.chorus.attachments.pickFiles();
    if (!sources.length) return;
    setIngesting(true);
    try {
      const atts = await window.chorus.attachments.ingest(sources);
      setAttachments((a) => a.concat(atts));
    } finally {
      setIngesting(false);
    }
  };

  const submit = async () => {
    const t = text.trim();
    if (!t && attachments.length === 0) return;
    if (busy) return;
    setText('');
    const atts = attachments;
    setAttachments([]);
    await send(t || '(see attachments)', mode, atts);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };

  return (
    <div className="px-6 pb-5"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); ingest([...e.dataTransfer.files]); }}>
      <motion.div layout transition={settle} className="surface relative p-2.5" style={{ boxShadow: dragging ? '0 0 0 2px var(--accent)' : 'var(--shadow-pop)' }}>
        <AnimatePresence>
          {dragging && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[var(--radius)] text-ui font-medium" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              Drop to attach to this message
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {attachments.length > 0 && (
            <motion.div layout className="mb-2 flex flex-wrap gap-1.5 px-1">
              {attachments.map((a) => <AttachmentChip key={a.id} att={a} onRemove={() => setAttachments((l) => l.filter((x) => x.id !== a.id))} />)}
            </motion.div>
          )}
        </AnimatePresence>
        <textarea ref={area} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={1}
          onPaste={(e) => { const files = [...e.clipboardData.files]; if (files.length) { e.preventDefault(); ingest(files); } }}
          placeholder={mode === 'solo' ? `Message ${settings?.soloProvider === 'codex' ? 'ChatGPT' : 'Claude'}…` : mode === 'compare' ? 'Ask both models, side by side…' : 'Ask both models to work it out together…'}
          className="selectable w-full bg-transparent px-2 py-1.5 text-body outline-none" aria-label="Message" />
        <div className="mt-1 flex items-center gap-2 px-1">
          <ModeSwitch mode={mode} solo={settings?.soloProvider ?? 'claude'} onMode={setMode} onSolo={(p) => saveSettings({ soloProvider: p })} />
          <button className="btn btn-ghost btn-icon shrink-0" onClick={pick} aria-label="Attach files" title="Attach files" disabled={ingesting}><Paperclip size={16} /></button>
          {ingesting && <span className="hint" role="status">Reading file…</span>}
          <span className="hint ml-auto hidden lg:inline">Return to send · Shift-Return for a new line</span>
          <AnimatePresence initial={false} mode="popLayout">
            {busy ? (
              <motion.button key="stop" className="btn btn-icon shrink-0" onClick={cancel} aria-label="Stop replying" title="Stop replying"
                initial={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }} transition={{ type: 'spring', duration: 0.3, bounce: 0 }}>
                <Stop size={15} weight="fill" />
              </motion.button>
            ) : (
              <motion.button key="send" className="btn btn-primary btn-icon shrink-0" onClick={submit} aria-label="Send" title="Send (Return)" aria-disabled={!text.trim() && attachments.length === 0}
                initial={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }} transition={{ type: 'spring', duration: 0.3, bounce: 0 }}>
                <ArrowUp size={16} weight="bold" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
        <AnimatePresence initial={false}>
          {mode === 'consensus' && (
            <motion.div key="consensus" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0, transition: { duration: 0.15, ease: 'easeOut' } }} transition={settle} className="overflow-hidden">
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pt-2 text-meta" style={{ boxShadow: 'inset 0 1px 0 var(--line)', color: 'var(--ink-2)' }}>
                <span id="starts-label" className="whitespace-nowrap" title="Both models answer independently first. This one critiques first.">First critic</span>
                <Segmented<Provider> ariaLabelledBy="starts-label" value={settings?.consensusStarter ?? 'codex'} onChange={(p) => saveSettings({ consensusStarter: p })}
                  options={[{ value: 'codex', label: 'ChatGPT' }, { value: 'claude', label: 'Claude' }]} />
                <label htmlFor="max-turns" className="ml-1 whitespace-nowrap">Most turns</label>
                <Select id="max-turns" size="sm" value={String(settings?.consensusMaxTurns ?? 6)}
                  options={turnOptions(settings?.consensusMaxTurns ?? 6).map((n) => ({ value: String(n), label: String(n) }))}
                  onChange={(v) => saveSettings({ consensusMaxTurns: Number(v) })} />
                <span className="hint ml-auto whitespace-nowrap">They stop early once both find no material objections.</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

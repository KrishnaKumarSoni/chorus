import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Paperclip, ArrowUp, Stop } from '@phosphor-icons/react';
import { filesToSources, useChorus } from '../lib/state';
import { ModeSwitch } from './ModeSwitch';
import { AttachmentChip } from './AttachmentChip';
import type { Attachment, Mode } from '../../shared/types';
import { settle } from '../lib/motion';

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
      <motion.div layout transition={settle} className="surface relative p-2.5" style={{ borderColor: dragging ? 'var(--accent)' : 'var(--line)' }}>
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
          placeholder={mode === 'solo' ? 'Message…' : mode === 'compare' ? 'Ask both models side by side…' : 'Ask both models to reach a consensus…'}
          className="selectable w-full bg-transparent px-2 py-1.5 text-body outline-none" aria-label="Message" />
        <div className="mt-1 flex items-center gap-2 px-1">
          <ModeSwitch mode={mode} solo={settings?.soloProvider ?? 'claude'} onMode={setMode} onSolo={(p) => saveSettings({ soloProvider: p })} />
          <button className="btn btn-ghost p-1.5" onClick={pick} aria-label="Attach files" title="Attach files" disabled={ingesting}><Paperclip size={16} /></button>
          {ingesting && <span className="hint">Reading file…</span>}
          <span className="hint ml-auto hidden lg:inline">Enter to send · Shift-Enter for a new line</span>
          {busy ? (
            <button className="btn btn-primary p-1.5" onClick={cancel} aria-label="Stop" style={{ background: 'var(--danger)' }}><Stop size={16} weight="fill" /></button>
          ) : (
            <motion.button whileTap={{ scale: 0.96 }} className="btn btn-primary p-1.5" onClick={submit} aria-label="Send" aria-disabled={!text.trim() && attachments.length === 0}><ArrowUp size={16} weight="bold" /></motion.button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

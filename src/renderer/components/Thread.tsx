import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useChorus } from '../lib/state';
import { MessageCard, UserCard } from './MessageCard';
import type { Turn } from '../../shared/types';
import { settle } from '../lib/motion';

interface Exchange { id: string; user: Turn; replies: Turn[] }

export function Thread() {
  const { current, rename } = useChorus();
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(current?.title ?? '');

  const exchanges = useMemo<Exchange[]>(() => {
    const map = new Map<string, Exchange>();
    for (const t of current?.turns ?? []) {
      if (t.role === 'user') map.set(t.exchangeId, { id: t.exchangeId, user: t, replies: [] });
      else map.get(t.exchangeId)?.replies.push(t);
    }
    return [...map.values()];
  }, [current?.turns]);

  useEffect(() => { setTitle(current?.title ?? ''); setEditing(false); }, [current?.id, current?.title]);
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [current?.turns, pinned]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="drag-region flex items-center gap-3 px-6 pt-[42px] pb-3">
        {editing ? (
          <input autoFocus aria-label="Conversation title" className="field no-drag max-w-[480px] text-title font-semibold" value={title} onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { setEditing(false); if (title.trim() && title !== current?.title) rename(title.trim()); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTitle(current?.title ?? ''); setEditing(false); } }} />
        ) : (
          <button className="no-drag display truncate rounded-[6px] px-1 text-left text-title font-semibold hover:bg-[var(--line)]" onClick={() => setEditing(true)} aria-label={`Rename conversation: ${current?.title}`} title="Click to rename">{current?.title}</button>
        )}
        <span className="mono ml-auto text-caption" style={{ color: 'var(--muted)' }}>{current?.turns.length ?? 0} turns{current?.compactions.length ? ` · ${current.compactions.length} compaction${current.compactions.length > 1 ? 's' : ''}` : ''}</span>
      </header>
      <div ref={scroller} onScroll={onScroll} className="scroll min-h-0 flex-1 px-6 pb-6">
        {exchanges.length === 0 && (
          <div className="flex h-full items-end pb-6">
            <p className="max-w-[440px] text-body" style={{ color: 'var(--ink-2)' }}>
              Ask anything. Choose <b>Solo</b>, <b>Compare</b> or <b>Consensus</b> per message; add files to the context panel on the right so both models see the same material.
            </p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {exchanges.map((ex) => (
            <motion.section key={ex.id} layout="position" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={settle} className="mb-8">
              <UserCard turn={ex.user} />
              <Replies exchange={ex} />
            </motion.section>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Replies({ exchange }: { exchange: Exchange }) {
  const mode = exchange.user.mode;
  if (mode === 'solo') return <div className="mt-3">{exchange.replies.map((t) => <MessageCard key={t.id} turn={t} />)}</div>;
  if (mode === 'compare') {
    return <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>{exchange.replies.map((t) => <MessageCard key={t.id} turn={t} />)}</div>;
  }
  // Consensus is one chronological conversation, not a set of rounds.
  const ordered = [...exchange.replies].sort((a, b) => a.index - b.index);
  const settled = ordered.length >= 2 && ordered[ordered.length - 1].agreed && ordered[ordered.length - 2].agreed;
  return (
    <div className="mt-3 flex flex-col gap-3">
      {ordered.map((t) => <MessageCard key={t.id} turn={t} />)}
      {settled && (
        <p className="text-caption" style={{ color: 'var(--muted)' }}>Both models agreed, so the discussion stopped here.</p>
      )}
    </div>
  );
}

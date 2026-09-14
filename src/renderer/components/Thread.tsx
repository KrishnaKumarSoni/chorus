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
          <input autoFocus className="field no-drag max-w-[480px] text-[15px] font-semibold" value={title} onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { setEditing(false); if (title.trim() && title !== current?.title) rename(title.trim()); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTitle(current?.title ?? ''); setEditing(false); } }} />
        ) : (
          <button className="no-drag display truncate text-left text-[15px] font-semibold" onClick={() => setEditing(true)} title="Rename">{current?.title}</button>
        )}
        <span className="mono ml-auto text-[11px]" style={{ color: 'var(--muted)' }}>{current?.turns.length ?? 0} turns{current?.compactions.length ? ` · ${current.compactions.length} compaction${current.compactions.length > 1 ? 's' : ''}` : ''}</span>
      </header>
      <div ref={scroller} onScroll={onScroll} className="scroll min-h-0 flex-1 px-6 pb-6">
        {exchanges.length === 0 && (
          <div className="flex h-full items-end pb-6">
            <p className="max-w-[440px] text-[14px]" style={{ color: 'var(--ink-2)' }}>
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
  const rounds = [1, 2, 3].map((r) => exchange.replies.filter((t) => t.round === r));
  const label = ['Round 1 · independent answers', 'Round 2 · critiques', 'Consensus'];
  return (
    <div className="mt-3 flex flex-col gap-4">
      {rounds.map((turns, i) =>
        turns.length === 0 ? null : (
          <div key={i}>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: i === 2 ? 'var(--accent)' : 'var(--muted)' }}>
              <span className="h-px flex-1" style={{ background: 'var(--line-strong)' }} />
              {label[i]}
              <span className="h-px flex-1" style={{ background: 'var(--line-strong)' }} />
            </div>
            <div className="grid gap-3" style={{ gridTemplateColumns: i === 2 ? '1fr' : 'repeat(auto-fit, minmax(300px, 1fr))' }}>
              {turns.map((t) => <MessageCard key={t.id} turn={t} emphasis={i === 2} />)}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

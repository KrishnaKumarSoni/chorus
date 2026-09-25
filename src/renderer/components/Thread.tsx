import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CaretRight } from '@phosphor-icons/react';
import { useChorus } from '../lib/state';
import { MessageCard, UserCard } from './MessageCard';
import type { Turn } from '../../shared/types';
import { settle } from '../lib/motion';

interface Exchange { id: string; user: Turn; replies: Turn[] }

export function Thread() {
  const { current, rename, busy } = useChorus();
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
      <header className="drag-region thread-header flex items-center gap-3 pt-[42px] pr-6 pb-3">
        {editing ? (
          <input autoFocus aria-label="Conversation title" className="field no-drag max-w-[480px] text-title font-semibold" value={title} onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { setEditing(false); if (title.trim() && title !== current?.title) rename(title.trim()); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTitle(current?.title ?? ''); setEditing(false); } }} />
        ) : (
          <button className="no-drag display truncate rounded-[6px] px-1.5 py-0.5 text-left text-title font-semibold transition-colors duration-150 ease-out hover:bg-[var(--fill-strong)]" onClick={() => setEditing(true)} aria-label={`Rename conversation: ${current?.title}`} title="Rename">{current?.title}</button>
        )}
        <span className="ml-auto shrink-0 text-caption tabular" style={{ color: 'var(--muted)' }}>{current?.turns.length ?? 0} {current?.turns.length === 1 ? 'turn' : 'turns'}{current?.compactions.length ? ` · ${current.compactions.length} compaction${current.compactions.length > 1 ? 's' : ''}` : ''}</span>
      </header>
      <div ref={scroller} onScroll={onScroll} className="scroll scroll-fade min-h-0 flex-1 px-6 pb-6">
        {exchanges.length === 0 && (
          <div className="flex h-full items-end pb-6">
            <div className="max-w-[460px]">
              <p className="text-title font-semibold">Ask anything</p>
              <p className="mt-1 text-body" style={{ color: 'var(--ink-2)', textWrap: 'pretty' }}>
                Pick <b>Solo</b>, <b>Compare</b> or <b>Consensus</b> for each message. Add reference files on the right so both models work from the same material.
              </p>
            </div>
          </div>
        )}
        <AnimatePresence initial={false}>
          {exchanges.map((ex) => (
            <motion.section key={ex.id} layout="position" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={settle} className="mb-8">
              <UserCard turn={ex.user} />
              <Replies exchange={ex} finished={!(busy && ex.id === exchanges[exchanges.length - 1].id)} />
            </motion.section>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Replies({ exchange, finished }: { exchange: Exchange; finished: boolean }) {
  const mode = exchange.user.mode;
  if (mode === 'solo') return <div className="mt-3">{exchange.replies.map((t) => <MessageCard key={t.id} turn={t} />)}</div>;
  if (mode === 'compare') {
    return <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>{exchange.replies.map((t) => <MessageCard key={t.id} turn={t} />)}</div>;
  }
  // Consensus: two independent answers, then one chronological debate, then one summary.
  const all = [...exchange.replies].sort((a, b) => a.index - b.index);
  const summary = all.find((t) => t.kind === 'synthesis');
  const ordered = all.filter((t) => t.kind !== 'synthesis');
  return (
    <div className="mt-3 flex flex-col gap-3">
      {summary && <MessageCard turn={summary} emphasis startedAt={exchange.user.createdAt} />}
      <Discussion ordered={ordered} finished={finished} collapsible={!!summary} />
    </div>
  );
}

function Discussion({ ordered, finished, collapsible }: { ordered: Turn[]; finished: boolean; collapsible: boolean }) {
  const [open, setOpen] = useState(false);
  const last = ordered[ordered.length - 1];
  // Openings never carry agreement, so two agreeing turns in a row always come from the critique.
  const settled = ordered.length >= 2 && !!last?.agreed && !!ordered[ordered.length - 2].agreed;
  const atLimit = finished && !settled && last?.status === 'done';
  const body = (
    <>
      {ordered.map((t, i) => (
        <React.Fragment key={t.id}>
          {i === 2 && ordered[0].independent && <Divider>Each answered without seeing the other. The critique starts here.</Divider>}
          <MessageCard turn={t} />
        </React.Fragment>
      ))}
      {settled && <p className="text-caption" style={{ color: 'var(--muted)' }}>Both models found no remaining material objections, so the discussion stopped here.</p>}
      {atLimit && <p className="text-caption" style={{ color: 'var(--muted)' }}>The discussion reached its turn limit. Objections may remain; the summary marks what is still unresolved.</p>}
    </>
  );
  if (!collapsible) return body;
  return (
    <>
      <button className="btn btn-ghost btn-sm self-start" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CaretRight size={12} weight="bold" aria-hidden style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms ease-out' }} />
        {open ? 'Hide the discussion' : `Show the discussion (${ordered.length} turns)`}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="discussion" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0, transition: { duration: 0.15, ease: 'easeOut' } }} transition={settle} className="flex flex-col gap-3 overflow-hidden">
            {body}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-3 py-1 text-caption" style={{ color: 'var(--muted)' }}>
      <span className="h-px flex-1" style={{ background: 'var(--line)' }} aria-hidden />
      {children}
      <span className="h-px flex-1" style={{ background: 'var(--line)' }} aria-hidden />
    </p>
  );
}

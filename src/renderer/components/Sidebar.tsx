import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Gear, Trash } from '@phosphor-icons/react';
import { useChorus } from '../lib/state';
import { settle } from '../lib/motion';

export function Sidebar() {
  const { conversations, current, open, create, remove, setSettingsOpen, statuses } = useChorus();
  const problems = statuses.filter((s) => !s.ok);
  return (
    <aside className="chrome flex h-full min-h-0 flex-col" style={{ background: 'var(--sidebar-bg)', borderRight: '1px solid var(--line)' }}>
      <div className="drag-region flex items-center justify-between pt-[46px] pb-2 pr-2 pl-4">
        <span className="text-caption font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--muted)' }}>Conversations</span>
        <button className="btn btn-ghost no-drag p-1.5" onClick={() => create()} aria-label="New conversation" title="New conversation (⌘N)">
          <Plus size={15} weight="bold" />
        </button>
      </div>
      <nav className="scroll min-h-0 flex-1 px-2 pb-2">
        {conversations.length === 0 && <p className="hint px-2 py-3">Nothing yet. Press ⌘N to begin.</p>}
        <AnimatePresence initial={false}>
          {conversations.map((c, i) => {
            const active = c.id === current?.id;
            return (
              <motion.div key={c.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { ...settle, delay: Math.min(i, 8) * 0.03 } }} exit={{ opacity: 0, x: -12 }}
                className="group relative">
                <button onClick={() => open(c.id)}
                  className="w-full rounded-[9px] px-2.5 py-2 text-left"
                  style={{ background: active ? 'var(--panel-solid)' : 'transparent', boxShadow: active ? 'var(--shadow)' : 'none' }}>
                  <span className="block truncate text-ui">{c.title}</span>
                  <span className="mono mt-0.5 block text-caption" style={{ color: 'var(--muted)' }}>{c.mode} · {c.turnCount} turns · {relative(c.updatedAt)}</span>
                </button>
                <button className="btn btn-ghost absolute top-1 right-1 p-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Delete ${c.title}`}
                  onClick={(e) => { e.stopPropagation(); if (confirm(`Delete “${c.title}”? This cannot be undone.`)) remove(c.id); }}>
                  <Trash size={13} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </nav>
      <div className="border-t px-2 py-2 hairline">
        <button className="btn btn-ghost w-full justify-start gap-2 text-meta" onClick={() => setSettingsOpen(true)}>
          <Gear size={15} />
          Settings
          {problems.length > 0 && <span className="ml-auto text-caption" style={{ color: 'var(--danger)' }} title={problems.map((p) => p.detail).join('\n')}>{problems.length} issue{problems.length > 1 ? 's' : ''}</span>}
        </button>
      </div>
    </aside>
  );
}

function relative(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.round(d / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

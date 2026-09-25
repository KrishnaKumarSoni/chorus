import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Gear, Trash, WarningCircle } from '@phosphor-icons/react';
import { useChorus } from '../lib/state';
import { settle } from '../lib/motion';

const MODE_LABEL = { solo: 'Solo', compare: 'Compare', consensus: 'Consensus' } as const;

export function Sidebar() {
  const { conversations, current, open, create, remove, setSettingsOpen, statuses, settings } = useChorus();
  const problems = statuses.filter((s) => !s.ok);
  const hidden = !!settings?.sidebarCollapsed;
  return (
    <aside id="sidebar" aria-label="Conversations" className="sidebar chrome" style={{ background: 'var(--sidebar-bg)', boxShadow: hidden ? 'none' : 'inset -1px 0 0 var(--line)' }} {...(hidden ? { inert: true } : {})}>
      <div className="sidebar-inner flex min-h-0 flex-col">
        <div className="drag-region flex items-center justify-between pt-[46px] pb-1.5 pr-2.5 pl-4">
          <h2 className="eyebrow">Conversations</h2>
          <button className="btn btn-ghost btn-icon no-drag" onClick={() => create()} aria-label="New conversation" title="New conversation (⌘N)">
            <Plus size={15} weight="bold" />
          </button>
        </div>
        <nav aria-label="Conversation list" className="scroll min-h-0 flex-1 px-2 pb-2">
          {conversations.length === 0 && (
            <div className="px-2 py-3">
              <p className="text-ui font-medium">No conversations yet</p>
              <p className="hint mt-0.5">Each one keeps its own transcript, files and instructions.</p>
              <button className="btn btn-sm mt-3" onClick={() => create()}>New conversation</button>
            </div>
          )}
          <AnimatePresence initial={false}>
            {conversations.map((c) => {
              const active = c.id === current?.id;
              return (
                <motion.div key={c.id} layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: 0.15, ease: 'easeOut' } }} transition={settle}
                  className="group relative">
                  <button onClick={() => open(c.id)} aria-current={active ? 'page' : undefined}
                    className="sidebar-row w-full rounded-[9px] py-2 pr-9 pl-2.5 text-left" data-active={active}>
                    <span className="block truncate text-ui" style={{ fontWeight: active ? 550 : 400 }} title={c.title}>{c.title}</span>
                    <span className="mt-0.5 block text-caption tabular" style={{ color: 'var(--muted)' }}>{MODE_LABEL[c.mode]} · {c.turnCount} {c.turnCount === 1 ? 'turn' : 'turns'} · {relative(c.updatedAt)}</span>
                  </button>
                  <button className="btn btn-ghost btn-icon absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Delete “${c.title}”`} title="Delete conversation"
                    onClick={(e) => { e.stopPropagation(); if (confirm(`Delete “${c.title}”? This removes its transcript and files and cannot be undone.`)) remove(c.id); }}>
                    <Trash size={14} />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </nav>
        <div className="px-2 py-2" style={{ boxShadow: 'inset 0 1px 0 var(--line)' }}>
          <button className="btn btn-ghost w-full justify-start gap-2" onClick={() => setSettingsOpen(true)} title="Settings (⌘,)">
            <Gear size={16} />
            Settings
            {problems.length > 0 && (
              <span className="ml-auto flex items-center gap-1 text-caption" style={{ color: 'var(--danger)' }} title={problems.map((p) => p.detail).join('\n')}>
                <WarningCircle size={13} weight="bold" aria-hidden />
                {problems.length === 1 ? '1 account needs attention' : `${problems.length} accounts need attention`}
              </span>
            )}
          </button>
        </div>
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

import React, { useEffect } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { X, SidebarSimple, NotePencil } from '@phosphor-icons/react';
import { useChorus } from '../lib/state';
import { Sidebar } from './Sidebar';
import { Thread } from './Thread';
import { Composer } from './Composer';
import { ContextPanel } from './ContextPanel';
import { SettingsSheet } from './SettingsSheet';
import { settle } from '../lib/motion';

export function App() {
  const { current, toasts, settingsOpen, setSettingsOpen, create, dismissToast, settings, toggleSidebar } = useChorus();
  const collapsed = !!settings?.sidebarCollapsed;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === ',') { e.preventDefault(); setSettingsOpen(true); }
      if (e.metaKey && !e.shiftKey && e.key === 'n') { e.preventDefault(); create(); }
      // ⌃⌘S is the macOS convention for showing and hiding a sidebar.
      if (e.metaKey && e.ctrlKey && e.code === 'KeyS') { e.preventDefault(); toggleSidebar(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSettingsOpen, create, toggleSidebar]);

  const latest = toasts[toasts.length - 1];
  return (
    <MotionConfig reducedMotion="user">
    <div className="app-grid" data-sidebar={collapsed ? 'collapsed' : 'open'} {...(settingsOpen ? { inert: true } : {})}>
      <Sidebar />
      <main className="relative flex min-w-0 flex-col" style={{ background: 'var(--bg)' }}>
        {current ? (
          <>
            <Thread />
            <Composer />
          </>
        ) : (
          <EmptyState onCreate={() => create()} />
        )}
      </main>
      <ContextPanel />
      <div className="chrome no-drag fixed top-[10px] left-[78px] z-30 flex items-center gap-0.5">
        <button className="btn btn-ghost btn-icon" onClick={toggleSidebar} aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'} aria-expanded={!collapsed} aria-controls="sidebar" title={`${collapsed ? 'Show' : 'Hide'} sidebar (⌃⌘S)`}>
          <SidebarSimple size={17} style={{ color: 'var(--ink-2)' }} />
        </button>
        <AnimatePresence initial={false}>
          {collapsed && (
            <motion.button key="new" className="btn btn-ghost btn-icon" onClick={() => create()} aria-label="New conversation" title="New conversation (⌘N)"
              initial={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }} transition={{ type: 'spring', duration: 0.3, bounce: 0 }}>
              <NotePencil size={17} style={{ color: 'var(--ink-2)' }} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
      <AnimatePresence>{settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}</AnimatePresence>
      <div role="status" aria-live="polite" className="sr-only">{latest?.text ?? ''}</div>
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={settle}
              className="surface flex items-center gap-2 px-3.5 py-2 text-meta" style={{ borderColor: t.kind === 'error' ? 'var(--danger)' : 'var(--line)', pointerEvents: t.kind === 'error' ? 'auto' : 'none' }}>
              <span className="selectable">{t.text}</span>
              {t.kind === 'error' && <button className="btn btn-ghost p-1.5" aria-label="Dismiss" onClick={() => dismissToast(t.id)}><X size={12} weight="bold" /></button>}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="drag-region flex h-full flex-col justify-end px-12 pb-16">
      <div className="no-drag max-w-[520px]">
        <h1 className="display text-display font-semibold">One transcript. Two models. Your call every message.</h1>
        <p className="mt-3 text-body" style={{ color: 'var(--ink-2)', textWrap: 'pretty' }}>
          Ask Claude or ChatGPT alone, run them side by side, or let them talk it through until they agree. Files, images and your standing instructions travel with every turn.
        </p>
        <button className="btn btn-primary mt-6 min-h-[34px] px-4 text-ui" onClick={onCreate}>Start a conversation</button>
        <p className="hint mono mt-3">⌘N new conversation · ⌘, settings · ⌃⌘S sidebar</p>
      </div>
    </div>
  );
}

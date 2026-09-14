import React, { useEffect } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { X } from '@phosphor-icons/react';
import { useChorus } from '../lib/state';
import { Sidebar } from './Sidebar';
import { Thread } from './Thread';
import { Composer } from './Composer';
import { ContextPanel } from './ContextPanel';
import { SettingsSheet } from './SettingsSheet';
import { settle } from '../lib/motion';

export function App() {
  const { current, toasts, settingsOpen, setSettingsOpen, create, dismissToast } = useChorus();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === ',') { e.preventDefault(); setSettingsOpen(true); }
      if (e.metaKey && e.key === 'n') { e.preventDefault(); create(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSettingsOpen, create]);

  const latest = toasts[toasts.length - 1];
  return (
    <MotionConfig reducedMotion="user">
    <div className="app-grid" {...(settingsOpen ? { inert: true } : {})}>
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
        <p className="display text-display font-semibold">One transcript. Two models. Your call every message.</p>
        <p className="mt-3 text-body" style={{ color: 'var(--ink-2)' }}>
          Ask Claude or GPT alone, run them side by side, or make them argue it out to a consensus. Files, images and your standing instructions travel with every turn.
        </p>
        <button className="btn btn-primary mt-6 text-ui" onClick={onCreate}>Start a conversation</button>
        <p className="hint mt-3 mono">⌘N new · ⌘, settings</p>
      </div>
    </div>
  );
}

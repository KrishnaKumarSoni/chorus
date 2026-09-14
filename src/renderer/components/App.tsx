import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useChorus } from '../lib/state';
import { Sidebar } from './Sidebar';
import { Thread } from './Thread';
import { Composer } from './Composer';
import { ContextPanel } from './ContextPanel';
import { SettingsSheet } from './SettingsSheet';
import { settle } from '../lib/motion';

export function App() {
  const { current, toasts, settingsOpen, setSettingsOpen, create } = useChorus();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === ',') { e.preventDefault(); setSettingsOpen(true); }
      if (e.metaKey && e.key === 'n') { e.preventDefault(); create(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSettingsOpen, create]);

  return (
    <div className="grid h-full" style={{ gridTemplateColumns: '248px minmax(0, 1fr) 300px' }}>
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
      <AnimatePresence>{settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}</AnimatePresence>
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={settle}
              className="surface px-3.5 py-2 text-[12.5px]" style={{ borderColor: t.kind === 'error' ? 'var(--danger)' : 'var(--line)' }}>
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="drag-region flex h-full flex-col justify-end px-12 pb-16">
      <div className="no-drag max-w-[520px]">
        <p className="display text-[30px] font-semibold">One transcript. Two models. Your call every message.</p>
        <p className="mt-3 text-[14px]" style={{ color: 'var(--ink-2)' }}>
          Ask Claude or GPT alone, run them side by side, or make them argue it out to a consensus. Files, images and your standing instructions travel with every turn.
        </p>
        <button className="btn btn-primary mt-6 text-[13px]" onClick={onCreate}>Start a conversation</button>
        <p className="hint mt-3 mono">⌘N new · ⌘, settings</p>
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CaretDown, Check } from '@phosphor-icons/react';
import type { Mode, Provider } from '../../shared/types';
import { pop, quick } from '../lib/motion';

const LABEL: Record<Provider, string> = { claude: 'Claude', codex: 'ChatGPT' };

export function ModeSwitch({ mode, solo, onMode, onSolo }: { mode: Mode; solo: Provider; onMode: (m: Mode) => void; onSolo: (p: Provider) => void }) {
  const [menu, setMenu] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    const onClick = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setMenu(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick); };
  }, [menu]);
  const items: Array<{ id: Mode; label: string }> = [
    { id: 'solo', label: `Solo · ${LABEL[solo]}` },
    { id: 'compare', label: 'Compare' },
    { id: 'consensus', label: 'Consensus' },
  ];
  return (
    <div className="relative" ref={root}>
      <div role="group" aria-label="Reply mode" className="segmented">
        {items.map((it) => (
          <button key={it.id} aria-pressed={mode === it.id} {...(it.id === 'solo' ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': menu } : {})}
            className="segment" style={{ color: mode === it.id ? 'var(--ink)' : 'var(--ink-2)' }}
            onClick={() => { onMode(it.id); if (it.id === 'solo' && mode === 'solo') setMenu((m) => !m); else setMenu(false); }}>
            {mode === it.id && <motion.span layoutId="mode-pill" className="segment-pill" transition={quick} />}
            {it.label}
            {it.id === 'solo' && <CaretDown size={11} weight="bold" style={{ color: 'var(--muted)' }} />}
          </button>
        ))}
      </div>
      <AnimatePresence>
        {menu && (
          <motion.div initial={{ opacity: 0, scale: 0.96, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12, ease: 'easeOut' } }} transition={pop} style={{ transformOrigin: 'bottom left' }}
            role="menu" aria-label="Solo replies come from" className="popover absolute bottom-full left-0 z-20 mb-2 min-w-[200px]"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
              e.preventDefault();
              const items = [...(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))];
              const i = items.indexOf(document.activeElement as HTMLButtonElement);
              items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
            }}>
            <p className="eyebrow px-2 pt-1.5 pb-1">Solo replies come from</p>
            {(['claude', 'codex'] as Provider[]).map((p) => (
              <button key={p} role="menuitemradio" aria-checked={solo === p} autoFocus={solo === p} className="option items-center"
                onClick={() => { onSolo(p); setMenu(false); }}>
                <span className="h-2 w-2 rounded-full" style={{ background: `var(--${p})` }} aria-hidden />
                <span className="flex-1">{LABEL[p]}</span>
                {solo === p && <Check size={14} weight="bold" style={{ color: 'var(--accent)' }} aria-hidden />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

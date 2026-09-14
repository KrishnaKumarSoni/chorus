import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CaretDown, Check } from '@phosphor-icons/react';
import type { Mode, Provider } from '../../shared/types';
import { settle } from '../lib/motion';

const LABEL: Record<Provider, string> = { claude: 'Claude', codex: 'GPT' };

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
      <div role="group" aria-label="Reply mode" className="relative flex rounded-[12px] p-[3px]" style={{ background: 'var(--line)' }}>
        {items.map((it) => (
          <button key={it.id} aria-pressed={mode === it.id} {...(it.id === 'solo' ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': menu } : {})}
            className="relative z-10 flex items-center gap-1 rounded-[9px] px-3 py-1 text-meta font-medium"
            style={{ color: mode === it.id ? 'var(--ink)' : 'var(--ink-2)' }}
            onClick={() => { onMode(it.id); if (it.id === 'solo' && mode === 'solo') setMenu((m) => !m); else setMenu(false); }}>
            {mode === it.id && <motion.span layoutId="mode-pill" className="absolute inset-0 -z-10 rounded-[9px]" style={{ background: 'var(--panel-solid)', boxShadow: 'var(--shadow)' }} transition={settle} />}
            {it.label}
            {it.id === 'solo' && <CaretDown size={11} weight="bold" style={{ color: 'var(--muted)' }} />}
          </button>
        ))}
      </div>
      {menu && (
        <motion.div initial={{ opacity: 0, scale: 0.96, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={settle} style={{ transformOrigin: 'bottom left' }}
          role="menu" aria-label="Solo provider" className="surface absolute bottom-full left-0 z-20 mb-2 min-w-[180px] p-1">
          {(['claude', 'codex'] as Provider[]).map((p) => (
            <button key={p} role="menuitemradio" aria-checked={solo === p} className="flex w-full items-center justify-between rounded-[8px] px-2.5 py-1.5 text-left text-ui hover:bg-[var(--accent-soft)]"
              onClick={() => { onSolo(p); setMenu(false); }}>
              <span>{p === 'claude' ? 'Claude' : 'GPT via Codex'}</span>
              {solo === p && <Check size={14} weight="bold" style={{ color: 'var(--accent)' }} />}
            </button>
          ))}
        </motion.div>
      )}
    </div>
  );
}

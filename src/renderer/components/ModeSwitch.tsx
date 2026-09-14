import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { CaretDown } from '@phosphor-icons/react';
import type { Mode, Provider } from '../../shared/types';
import { settle } from '../lib/motion';

const LABEL: Record<Provider, string> = { claude: 'Claude', codex: 'GPT' };

export function ModeSwitch({ mode, solo, onMode, onSolo }: { mode: Mode; solo: Provider; onMode: (m: Mode) => void; onSolo: (p: Provider) => void }) {
  const [menu, setMenu] = useState(false);
  const items: Array<{ id: Mode; label: string }> = [
    { id: 'solo', label: `Solo · ${LABEL[solo]}` },
    { id: 'compare', label: 'Compare' },
    { id: 'consensus', label: 'Consensus' },
  ];
  return (
    <div className="relative">
      <div role="radiogroup" aria-label="Reply mode" className="relative flex rounded-[11px] p-[3px]" style={{ background: 'var(--line)' }}>
        {items.map((it) => (
          <button key={it.id} role="radio" aria-checked={mode === it.id}
            className="relative z-10 flex items-center gap-1 rounded-[9px] px-3 py-1 text-[12.5px] font-medium"
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
          className="surface absolute bottom-full left-0 z-20 mb-2 min-w-[180px] p-1">
          {(['claude', 'codex'] as Provider[]).map((p) => (
            <button key={p} className="flex w-full items-center justify-between rounded-[8px] px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--accent-soft)]"
              onClick={() => { onSolo(p); setMenu(false); }}>
              <span>{p === 'claude' ? 'Claude' : 'GPT via Codex'}</span>
              <span className="h-2 w-2 rounded-full" style={{ background: `var(--${p})`, opacity: solo === p ? 1 : 0.25 }} />
            </button>
          ))}
        </motion.div>
      )}
    </div>
  );
}

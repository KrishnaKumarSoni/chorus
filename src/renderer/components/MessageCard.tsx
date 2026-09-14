import React from 'react';
import { motion } from 'framer-motion';
import { Warning, Prohibit, Copy } from '@phosphor-icons/react';
import type { Turn } from '../../shared/types';
import { Markdown } from './Markdown';
import { useChorus } from '../lib/state';
import { AttachmentChip } from './AttachmentChip';
import { settle } from '../lib/motion';

const NAME = { claude: 'Claude', codex: 'GPT via Codex' } as const;
const LOGIN = { claude: 'claude login', codex: 'codex login' } as const;

export function UserCard({ turn }: { turn: Turn }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] rounded-[16px] rounded-br-[6px] px-4 py-2.5" style={{ background: 'var(--accent-soft)' }}>
        <p className="prose selectable whitespace-pre-wrap text-ui">{turn.text}</p>
        {turn.attachments?.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">{turn.attachments.map((a) => <AttachmentChip key={a.id} att={a} compact />)}</div>
        ) : null}
      </div>
    </div>
  );
}

export function MessageCard({ turn, emphasis }: { turn: Turn; emphasis?: boolean }) {
  const { setSettingsOpen } = useChorus();
  const p = turn.author?.provider ?? 'claude';
  const authError = turn.status === 'error' && /authenticat|login|sign in|unauthori/i.test(turn.error ?? '');
  const streaming = turn.status === 'streaming';
  const lastActivity = turn.activity?.[turn.activity.length - 1];
  return (
    <motion.article layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={settle}
      className="min-w-0 rounded-[var(--radius)] border px-4 py-3"
      style={{ borderColor: emphasis ? 'var(--accent)' : 'var(--line)', background: emphasis ? 'var(--accent-soft)' : 'var(--panel-solid)', boxShadow: emphasis ? 'none' : 'var(--shadow)' }}>
      <header className="mb-1.5 flex items-center gap-2 text-meta">
        <span className="h-2 w-2 rounded-full" style={{ background: `var(--${p})` }} />
        <span className="font-semibold">{NAME[p]}</span>
        <span className="mono truncate" style={{ color: 'var(--muted)' }}>{turn.author?.model}</span>
        {turn.kind && turn.kind !== 'answer' && <span className="rounded-full px-1.5 py-px text-caption font-semibold uppercase tracking-wide" style={{ background: `var(--${p}-soft)`, color: `var(--${p})` }}>{turn.kind}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {turn.usage && <span className="mono text-caption" style={{ color: 'var(--muted)' }} title="input / output tokens">{fmt(turn.usage.input)} in, {fmt(turn.usage.output)} out</span>}
          {turn.status === 'done' && (
            <button className="btn btn-ghost p-1.5" aria-label="Copy reply" onClick={() => navigator.clipboard.writeText(turn.text)}><Copy size={13} /></button>
          )}
        </span>
      </header>
      {turn.status === 'error' ? (
        <div className="rounded-[10px] px-3 py-2 text-meta" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
          <div className="flex items-start gap-2">
            <Warning size={16} weight="bold" className="mt-0.5 shrink-0" />
            <span className="selectable">{turn.error}</span>
          </div>
          <div className="mt-2 flex items-center gap-2 pl-6" style={{ color: 'var(--ink-2)' }}>
            <span>{authError ? <>Sign in again with <code className="mono">{LOGIN[p]}</code> in a terminal, then re-check providers.</> : 'Check the provider in Settings, then send again.'}</span>
            <button className="btn text-caption" onClick={() => setSettingsOpen(true)}>Open Settings</button>
          </div>
        </div>
      ) : null}
      {turn.text ? <Markdown text={turn.text} streaming={streaming} /> : streaming ? <Skeleton /> : null}
      {turn.status === 'cancelled' && (
        <p className="mt-2 flex items-center gap-1 text-meta" style={{ color: 'var(--muted)' }}><Prohibit size={13} /> Stopped here</p>
      )}
      {streaming && lastActivity && <p className="mono mt-2 text-caption" style={{ color: 'var(--muted)' }}>{lastActivity}…</p>}
      {!streaming && turn.activity?.some((a) => /compact|rebuild/i.test(a)) && (
        <p className="mono mt-2 text-caption" style={{ color: 'var(--muted)' }}>{turn.activity.filter((a) => /compact|rebuild/i.test(a)).join(' · ')}</p>
      )}
    </motion.article>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-2 py-1" role="status">
      <span className="sr-only">Waiting for reply</span>
      <div className="shimmer h-3 w-[86%]" />
      <div className="shimmer h-3 w-[64%]" />
      <div className="shimmer h-3 w-[72%]" />
    </div>
  );
}

function fmt(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

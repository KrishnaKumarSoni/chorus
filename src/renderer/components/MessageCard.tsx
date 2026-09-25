import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Warning, Prohibit, Copy, Check } from '@phosphor-icons/react';
import type { Turn } from '../../shared/types';
import { Markdown } from './Markdown';
import { stripAgreement } from '../../shared/consensus';
import { useChorus } from '../lib/state';
import { AttachmentChip } from './AttachmentChip';
import { settle } from '../lib/motion';

const NAME = { claude: 'Claude', codex: 'ChatGPT' } as const;

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
      style={{ borderColor: 'transparent', background: emphasis ? 'var(--accent-soft)' : 'var(--panel-solid)', boxShadow: emphasis ? '0 0 0 1px var(--accent)' : 'var(--shadow)' }}>
      <header className="mb-1.5 flex items-center gap-2 text-meta">
        <span className="h-2 w-2 rounded-full" style={{ background: `var(--${p})` }} />
        <span className="font-semibold">{NAME[p]}</span>
        <span className="mono truncate" style={{ color: 'var(--muted)' }}>{turn.author?.model}</span>
        {turn.kind && turn.kind !== 'answer' && <span className="rounded-full px-1.5 py-px text-caption font-semibold uppercase tracking-wide" style={{ background: `var(--${p}-soft)`, color: `var(--${p})` }}>{turn.kind}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {turn.usage && <span className="mono text-caption" style={{ color: 'var(--muted)' }} title="input / output tokens">{fmt(turn.usage.input)} in, {fmt(turn.usage.output)} out</span>}
          {turn.status === 'done' && <CopyButton text={stripAgreement(turn.text)} />}
        </span>
      </header>
      {turn.status === 'error' ? (
        <div className="rounded-[10px] px-3 py-2 text-meta" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
          <div className="flex items-start gap-2">
            <Warning size={16} weight="bold" className="mt-0.5 shrink-0" />
            <span className="selectable">{turn.error}</span>
          </div>
          <div className="mt-2 flex items-center gap-2 pl-6" style={{ color: 'var(--ink-2)' }}>
            <span>{authError ? `Your ${NAME[p]} session has expired. Sign in again from Settings, then send this message again.` : 'Check the provider in Settings, then send again.'}</span>
            <button className="btn btn-sm shrink-0" onClick={() => setSettingsOpen(true)}>Open Settings</button>
          </div>
        </div>
      ) : null}
      {turn.text ? <Markdown text={stripAgreement(turn.text)} streaming={streaming} /> : streaming ? <Skeleton /> : null}
      {turn.status === 'cancelled' && (
        <p className="mt-2 flex items-center gap-1 text-meta" style={{ color: 'var(--muted)' }}><Prohibit size={13} /> Stopped here</p>
      )}
      {streaming && <Working since={turn.createdAt} label={lastActivity ?? (turn.text ? 'Writing' : 'Thinking')} />}
      {!streaming && turn.activity?.some((a) => /compact|rebuild/i.test(a)) && (
        <p className="mono mt-2 text-caption" style={{ color: 'var(--muted)' }}>{turn.activity.filter((a) => /compact|rebuild/i.test(a)).join(' · ')}</p>
      )}
    </motion.article>
  );
}

/** Live status while a reply streams, so long thinking or searching never looks frozen. */
function Working({ since, label }: { since: string; label: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
  const elapsed = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`;
  return (
    <p className="mt-3 flex items-center gap-2 text-caption" style={{ color: 'var(--muted)' }}>
      <span className="working-dot" aria-hidden />
      <span role="status">{label}…</span>
      <span className="tabular" aria-hidden>{elapsed}</span>
    </p>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="btn btn-ghost btn-icon" aria-label={copied ? 'Copied' : 'Copy reply'} title={copied ? 'Copied' : 'Copy reply'}
      onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={copied ? 'done' : 'copy'} className="grid place-items-center"
          initial={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
          transition={{ type: 'spring', duration: 0.3, bounce: 0 }}>
          {copied ? <Check size={14} weight="bold" style={{ color: 'var(--accent)' }} /> : <Copy size={14} />}
        </motion.span>
      </AnimatePresence>
    </button>
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

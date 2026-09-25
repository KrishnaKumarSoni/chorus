import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, ArrowsClockwise, SignIn, ArrowSquareOut, SlidersHorizontal, Cpu, ChatsCircle, PaintBrush, CheckCircle, WarningCircle, CircleNotch } from '@phosphor-icons/react';
import { useChorus } from '../lib/state';
import type { Accent, Appearance, Effort, Mode, ModelDescriptor, Provider, ProviderStatus, Settings } from '../../shared/types';
import { DEFAULT_DEBATE_PROMPTS } from '../../shared/consensus';
import { pop, quick } from '../lib/motion';
import { Select, type SelectOption } from './ui/Select';
import { Segmented } from './ui/Segmented';
import { Switch } from './ui/Switch';

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const EFFORT_LABEL: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
const PROVIDER_LABEL: Record<Provider, string> = { claude: 'Claude', codex: 'ChatGPT' };

type Tab = 'general' | 'models' | 'debate' | 'appearance';
const TABS: Array<{ id: Tab; label: string; icon: typeof Cpu }> = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'models', label: 'Models', icon: Cpu },
  { id: 'debate', label: 'Consensus', icon: ChatsCircle },
  { id: 'appearance', label: 'Appearance', icon: PaintBrush },
];

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { settings, statuses, saveSettings } = useChorus();
  const [tab, setTab] = useState<Tab>(() => (statuses.some((s) => !s.ok) ? 'models' : 'general'));
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    return () => opener?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!settings) return null;

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = TABS[(i + d + TABS.length) % TABS.length];
    setTab(next.id);
    document.getElementById(`settings-tab-${next.id}`)?.focus();
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15, ease: 'easeOut' } }}
      className="fixed inset-0 z-40 flex items-center justify-center p-8" style={{ background: 'var(--scrim)' }} onClick={onClose}>
      <motion.div role="dialog" aria-modal="true" aria-labelledby="settings-title"
        initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: 4, transition: { duration: 0.15, ease: 'easeOut' } }} transition={pop}
        className="flex h-[min(680px,88vh)] w-[min(840px,100%)] overflow-hidden rounded-[18px]" style={{ background: 'var(--bg)', boxShadow: 'var(--shadow-sheet)' }}
        onClick={(e) => e.stopPropagation()}>
        <nav className="flex w-[200px] shrink-0 flex-col gap-0.5 p-3 pt-4" style={{ background: 'var(--fill)', boxShadow: 'inset -1px 0 0 var(--line)' }}>
          <h1 id="settings-title" className="display px-2.5 pb-3 text-heading font-semibold">Settings</h1>
          <div role="tablist" aria-orientation="vertical" aria-label="Settings sections" className="flex flex-col gap-0.5">
            {TABS.map((t, i) => {
              const on = tab === t.id;
              const Icon = t.icon;
              const alert = t.id === 'models' && statuses.some((s) => !s.ok);
              return (
                <button key={t.id} id={`settings-tab-${t.id}`} role="tab" aria-selected={on} aria-controls="settings-panel" tabIndex={on ? 0 : -1}
                  className="relative z-0 flex min-h-[32px] items-center gap-2.5 rounded-[8px] px-2.5 text-left text-ui"
                  style={{ color: on ? 'var(--ink)' : 'var(--ink-2)', fontWeight: on ? 550 : 400 }}
                  onClick={() => setTab(t.id)} onKeyDown={(e) => onTabKey(e, i)}>
                  {on && <motion.span layoutId="settings-tab" className="absolute inset-0 -z-10 rounded-[8px]" style={{ background: 'var(--raised)', boxShadow: 'var(--shadow)' }} transition={quick} />}
                  <Icon size={16} weight={on ? 'fill' : 'regular'} style={{ color: on ? 'var(--accent)' : 'var(--muted)' }} aria-hidden />
                  {t.label}
                  {alert && <WarningCircle size={14} weight="fill" className="ml-auto" style={{ color: 'var(--danger)' }} aria-label="needs attention" />}
                </button>
              );
            })}
          </div>
        </nav>
        <div className="relative flex min-w-0 flex-1 flex-col">
          <button ref={closeBtn} className="btn btn-ghost btn-icon absolute top-3 right-3 z-10" onClick={onClose} aria-label="Close settings" title="Close (Esc)"><X size={16} weight="bold" /></button>
          <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} className="scroll min-h-0 flex-1 px-8 pt-6 pb-8">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={quick}>
                {tab === 'general' && <General settings={settings} save={saveSettings} />}
                {tab === 'models' && <Models settings={settings} statuses={statuses} save={saveSettings} />}
                {tab === 'debate' && <Debate settings={settings} save={saveSettings} />}
                {tab === 'appearance' && <AppearancePane settings={settings} save={saveSettings} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

type Save = (patch: Partial<Settings>) => Promise<void>;

function PaneTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="mb-5 pr-10">
      <h2 className="display text-[20px] font-semibold">{title}</h2>
      {children && <p className="hint mt-1 max-w-[56ch] text-ui">{children}</p>}
    </header>
  );
}

function Row({ label, hint, htmlFor, labelId, children }: { label: string; hint?: React.ReactNode; htmlFor?: string; labelId?: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <div className="row-label">
        {htmlFor ? <label htmlFor={htmlFor} id={labelId}>{label}</label> : <div id={labelId}>{label}</div>}
        {hint && <p className="hint mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function General({ settings, save }: { settings: Settings; save: Save }) {
  const [text, setText] = useState(settings.globalInstructions);
  useEffect(() => setText(settings.globalInstructions), [settings.globalInstructions]);
  return (
    <>
      <PaneTitle title="General">How Chorus answers when you do not say otherwise.</PaneTitle>
      <section>
        <label className="label" htmlFor="global">Instructions for every conversation</label>
        <textarea id="global" className="field scroll selectable h-[160px] text-ui leading-relaxed" value={text} onChange={(e) => setText(e.target.value)}
          onBlur={() => { if (text !== settings.globalInstructions) save({ globalInstructions: text }); }}
          placeholder={'For example:\nI am a product manager.\nPrefer concise answers and challenge my assumptions.'} />
        <p className="hint mt-1.5">Both models read these in every conversation and every mode. Instructions for one chat go in its right-hand panel.</p>
      </section>
      <div className="settings-group mt-6">
        <Row label="Mode for new conversations" labelId="lbl-default-mode" hint="You can still switch per message in the composer.">
          <Segmented<Mode> ariaLabelledBy="lbl-default-mode" value={settings.defaultMode} onChange={(defaultMode) => save({ defaultMode })}
            options={[{ value: 'solo', label: 'Solo' }, { value: 'compare', label: 'Compare' }, { value: 'consensus', label: 'Consensus' }]} />
        </Row>
        <Row label="Solo replies come from" labelId="lbl-solo">
          <Segmented<Provider> ariaLabelledBy="lbl-solo" value={settings.soloProvider} onChange={(soloProvider) => save({ soloProvider })}
            options={[{ value: 'claude', label: 'Claude' }, { value: 'codex', label: 'ChatGPT' }]} />
        </Row>
      </div>
    </>
  );
}

function modelOptions(models: ModelDescriptor[], current: string): SelectOption<string>[] {
  const opts = models.map<SelectOption<string>>((m) => ({ value: m.id, label: m.label, detail: m.description, meta: m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k` : undefined }));
  if (current && !models.some((m) => m.id === current)) {
    opts.unshift({ value: current, label: current, detail: 'No longer offered to this account. Choose a current model.' });
  }
  return opts;
}

function Models({ settings, statuses, save }: { settings: Settings; statuses: ProviderStatus[]; save: Save }) {
  const { refreshStatus, limits } = useChorus();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <>
      <PaneTitle title="Models">Sign in to each provider, then choose a model and how hard it thinks.</PaneTitle>
      <div className="settings-group mb-5">
        <Row label="Let models search the web" labelId="lbl-web" hint="Both models can look up current facts and read pages. Replies take longer when they do.">
          <Switch labelledBy="lbl-web" checked={settings.webAccess} onChange={(webAccess) => save({ webAccess })} />
        </Row>
      </div>
      <div className="flex flex-col gap-5">
        {(['claude', 'codex'] as Provider[]).map((p) => (
          <ProviderGroup key={p} provider={p} status={statuses.find((s) => s.provider === p)} plan={limits.find((l) => l.provider === p)?.plan} settings={settings} save={save} />
        ))}
      </div>
      <div className="mt-5 flex items-center gap-4">
        <button className="btn shrink-0" disabled={refreshing} onClick={async () => { setRefreshing(true); try { await refreshStatus(); } finally { setRefreshing(false); } }}>
          <ArrowsClockwise size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden /> {refreshing ? 'Refreshing…' : 'Refresh models'}
        </button>
        <p className="hint">Sign-in opens the provider's own page in your browser. Chorus keeps the session, never your password.</p>
      </div>
    </>
  );
}

function ProviderGroup({ provider: p, status: st, plan, settings, save }: { provider: Provider; status?: ProviderStatus; plan?: string; settings: Settings; save: Save }) {
  const { auth, signIn, cancelSignIn, completeSignInManually, signOut } = useChorus();
  const [paste, setPaste] = useState('');
  const models = st?.models ?? [];
  const chosen = models.find((m) => m.id === settings.models[p]);
  const efforts = chosen?.efforts ?? EFFORTS;
  const a = auth[p];
  const busy = a.phase === 'awaiting-browser' || a.phase === 'exchanging';
  const effortValue = efforts.includes(settings.effort[p]) ? settings.effort[p] : efforts[efforts.length - 1];

  return (
    <section className="settings-group" aria-labelledby={`prov-${p}`}>
      <div className="row">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `var(--${p})` }} aria-hidden />
        <div className="row-label">
          <h3 id={`prov-${p}`} className="text-title font-semibold">{PROVIDER_LABEL[p]}</h3>
          <p className="hint mt-0.5 flex items-center gap-1.5">
            {!st ? <><CircleNotch size={12} className="animate-spin" aria-hidden /> Checking…</>
              : st.ok ? <><CheckCircle size={13} weight="fill" style={{ color: 'var(--accent)' }} aria-hidden /> Signed in{plan ? ` · ${plan} plan` : ''} · {models.length} models</>
                : <><WarningCircle size={13} weight="fill" style={{ color: 'var(--danger)' }} aria-hidden /> <span style={{ color: 'var(--danger)' }}>{st.detail}</span></>}
          </p>
        </div>
        {!busy && st && (st.ok
          ? <button className="btn btn-sm" onClick={() => signOut(p)}>Sign out</button>
          : <button className="btn btn-primary btn-sm" onClick={() => signIn(p)}><SignIn size={13} weight="bold" aria-hidden /> Sign in</button>)}
      </div>

      {busy && (
        <div className="row flex-col items-stretch" style={{ background: 'var(--accent-soft)' }} role="status">
          <p className="text-ui" style={{ color: 'var(--ink-2)' }}>
            {a.phase === 'exchanging' ? 'Finishing sign-in…' : 'Approve Chorus in the browser window that just opened.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {a.url && <a className="btn btn-sm" href={a.url} target="_blank" rel="noreferrer"><ArrowSquareOut size={12} aria-hidden /> Open the sign-in page again</a>}
            <button className="btn btn-ghost btn-sm" onClick={() => cancelSignIn(p)}>Cancel sign-in</button>
          </div>
          {p === 'claude' && a.phase === 'awaiting-browser' && (
            <div>
              <label className="label" htmlFor="paste-redirect">Signing in on another device? Paste the address it ended on.</label>
              <div className="flex gap-1.5">
                <input id="paste-redirect" className="field mono text-caption" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="http://localhost:53692/callback?code=…" />
                <button className="btn" disabled={!paste.trim()}
                  onClick={async () => { try { await completeSignInManually(p, paste); setPaste(''); } catch { /* the toast explains */ } }}>Finish sign-in</button>
              </div>
            </div>
          )}
        </div>
      )}
      {a.phase === 'error' && !busy && (
        <div className="row" role="alert">
          <p className="text-ui" style={{ color: 'var(--danger)' }}>{a.message ?? 'Sign-in did not finish.'} Try signing in again.</p>
        </div>
      )}

      <Row label="Model" htmlFor={`model-${p}`} hint={chosen?.description}>
        {models.length || !st ? (
          <Select id={`model-${p}`} className="w-[260px]" value={settings.models[p]} options={modelOptions(models, settings.models[p])} disabled={!st} placeholder="Loading models…"
            onChange={(v) => save({ models: { [p]: v } as Settings['models'] })} />
        ) : (
          <input id={`model-${p}`} className="field mono w-[260px]" defaultValue={settings.models[p]} placeholder="Model ID"
            onBlur={(e) => { if (e.target.value !== settings.models[p]) save({ models: { [p]: e.target.value } as Settings['models'] }); }} />
        )}
      </Row>
      <Row label="Effort" htmlFor={`effort-${p}`} hint={efforts.length ? 'Higher effort thinks longer and uses more of your plan.' : 'This model has no effort setting.'}>
        {efforts.length ? (
          <Select<Effort> id={`effort-${p}`} className="w-[260px]" value={effortValue} options={efforts.map((e) => ({ value: e, label: EFFORT_LABEL[e] }))}
            onChange={(v) => save({ effort: { [p]: v } as Settings['effort'] })} />
        ) : <span className="hint">Not adjustable</span>}
      </Row>
    </section>
  );
}

function Debate({ settings, save }: { settings: Settings; save: Save }) {
  return (
    <>
      <PaneTitle title="Consensus">Both models first answer on their own, without seeing each other's answer. Then they take turns critiquing until neither has a material objection left, or they reach the turn limit.</PaneTitle>
      <div className="settings-group">
        <Row label="First critic" labelId="lbl-starter" hint="Critiques first, once both independent answers are in.">
          <Segmented<Provider> ariaLabelledBy="lbl-starter" value={settings.consensusStarter} onChange={(consensusStarter) => save({ consensusStarter })}
            options={[{ value: 'codex', label: 'ChatGPT' }, { value: 'claude', label: 'Claude' }]} />
        </Row>
        <Row label="Most turns" htmlFor="max-turns-setting" hint="Includes the two independent answers. They stop earlier once both find no material objections.">
          <Select id="max-turns-setting" className="w-[128px]" value={String(settings.consensusMaxTurns)}
            options={[2, 4, 6, 8, 10, 12, 16, 20].map((n) => ({ value: String(n), label: `${n} turns` }))}
            onChange={(v) => save({ consensusMaxTurns: Number(v) })} />
        </Row>
      </div>
      <PromptField id="prompt-opening" label="Instructions for each independent answer" value={settings.debatePrompts.opening} fallback={DEFAULT_DEBATE_PROMPTS.opening}
        onSave={(opening) => save({ debatePrompts: { ...settings.debatePrompts, opening } })} />
      <PromptField id="prompt-reply" label="Instructions for each critique" value={settings.debatePrompts.reply} fallback={DEFAULT_DEBATE_PROMPTS.reply}
        onSave={(reply) => save({ debatePrompts: { ...settings.debatePrompts, reply } })} />
      <p className="hint mt-3">Write <code className="mono rounded-[4px] px-1" style={{ background: 'var(--fill-strong)' }}>{'{other}'}</code> where the other model's name should go. Chorus adds the agreement rule to every critique: a model may signal agreement only when no material objection survives, so the discussion can end early.</p>
    </>
  );
}

function PromptField({ id, label, value, fallback, onSave }: { id: string; label: string; value: string; fallback: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const isDefault = text.trim() === fallback.trim();
  return (
    <section className="mt-6">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label className="label mb-0" htmlFor={id}>{label}</label>
        <button className="btn btn-ghost btn-sm" disabled={isDefault} onClick={() => { setText(fallback); onSave(fallback); }}>Reset to default</button>
      </div>
      <textarea id={id} className="field scroll selectable h-[180px] text-ui leading-relaxed" value={text} onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (text !== value) onSave(text.trim() ? text : fallback); }} />
    </section>
  );
}

const APPEARANCES: Array<{ value: Appearance; label: string }> = [
  { value: 'system', label: 'Match system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const ACCENTS: Array<{ value: Accent; label: string }> = [
  { value: 'jade', label: 'Jade' },
  { value: 'iris', label: 'Iris' },
  { value: 'rose', label: 'Rose' },
  { value: 'graphite', label: 'Graphite' },
];

function AppearancePane({ settings, save }: { settings: Settings; save: Save }) {
  const { toggleSidebar } = useChorus();
  const roving = (e: React.KeyboardEvent, list: Array<{ value: string }>, i: number, pick: (v: string) => void, group: string) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + list.length) % list.length;
    pick(list[n].value);
    document.querySelectorAll<HTMLElement>(`[data-group="${group}"]`)[n]?.focus();
  };
  return (
    <>
      <PaneTitle title="Appearance" />
      <h3 id="lbl-theme" className="label">Theme</h3>
      <div role="radiogroup" aria-labelledby="lbl-theme" className="grid grid-cols-3 gap-3">
        {APPEARANCES.map((o, i) => {
          const on = settings.appearance === o.value;
          return (
            <button key={o.value} role="radio" aria-checked={on} tabIndex={on ? 0 : -1} data-group="theme"
              className="rounded-[14px] p-1.5 text-left transition-[box-shadow] duration-150 ease-out"
              style={{ boxShadow: on ? '0 0 0 2px var(--accent)' : 'var(--shadow)', background: 'var(--panel-solid)' }}
              onClick={() => save({ appearance: o.value })} onKeyDown={(e) => roving(e, APPEARANCES, i, (v) => save({ appearance: v as Appearance }), 'theme')}>
              <ThemePreview kind={o.value} />
              <span className="mt-2 flex items-center gap-1.5 px-1 pb-0.5 text-ui" style={{ fontWeight: on ? 550 : 400 }}>
                {o.label}
                {on && <CheckCircle size={14} weight="fill" style={{ color: 'var(--accent)' }} aria-hidden />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="settings-group mt-6">
        <Row label="Accent colour" labelId="lbl-accent" hint="Used for the send button, selection and focus.">
          <div role="radiogroup" aria-labelledby="lbl-accent" className="flex items-center gap-2">
            {ACCENTS.map((o, i) => {
              const on = settings.accent === o.value;
              return (
                <button key={o.value} role="radio" aria-checked={on} aria-label={o.label} title={o.label} tabIndex={on ? 0 : -1} data-group="accent" data-accent={o.value}
                  className="grid h-8 w-8 place-items-center rounded-full"
                  onClick={() => save({ accent: o.value })} onKeyDown={(e) => roving(e, ACCENTS, i, (v) => save({ accent: v as Accent }), 'accent')}>
                  <span className="grid h-5 w-5 place-items-center rounded-full" style={{ background: 'var(--accent)', boxShadow: on ? '0 0 0 2px var(--panel-solid), 0 0 0 4px var(--accent)' : 'inset 0 0 0 1px rgba(0,0,0,0.1)' }}>
                    {on && <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent-ink)' }} />}
                  </span>
                </button>
              );
            })}
          </div>
        </Row>
        <Row label="Sidebar" labelId="lbl-sidebar" hint="Show or hide it any time with ⌃⌘S.">
          <Segmented<'open' | 'hidden'> ariaLabelledBy="lbl-sidebar" value={settings.sidebarCollapsed ? 'hidden' : 'open'}
            onChange={(v) => { if ((v === 'hidden') !== settings.sidebarCollapsed) toggleSidebar(); }}
            options={[{ value: 'open', label: 'Shown' }, { value: 'hidden', label: 'Hidden' }]} />
        </Row>
      </div>
    </>
  );
}

/** A miniature window in fixed light or dark colours, so each option previews itself whatever the current theme. */
function ThemePreview({ kind }: { kind: Appearance }) {
  const light = { bg: '#f4f4f3', side: '#e9e9e7', card: '#ffffff', line: 'rgba(0,0,0,0.12)' };
  const dark = { bg: '#1b1b1d', side: '#232326', card: '#2c2c30', line: 'rgba(255,255,255,0.16)' };
  const pane = (c: typeof light, clip?: string) => (
    <div className="absolute inset-0 flex" style={{ background: c.bg, clipPath: clip }}>
      <div className="w-[26%]" style={{ background: c.side }}>
        <div className="mx-1.5 mt-3 h-1 rounded-full" style={{ background: c.line }} />
        <div className="mx-1.5 mt-1.5 h-1 w-2/3 rounded-full" style={{ background: c.line }} />
      </div>
      <div className="flex flex-1 flex-col p-2">
        <div className="h-3 w-3/4 rounded-[4px]" style={{ background: c.card, boxShadow: `0 0 0 1px ${c.line}` }} />
        <div className="mt-1.5 ml-auto h-3 w-1/2 rounded-[4px]" style={{ background: 'var(--accent)', opacity: 0.85 }} />
      </div>
    </div>
  );
  return (
    <div className="relative h-[76px] overflow-hidden rounded-[8px]" style={{ outline: '1px solid rgba(0,0,0,0.08)', outlineOffset: -1 }} aria-hidden>
      {kind === 'dark' ? pane(dark) : pane(light)}
      {kind === 'system' && pane(dark, 'polygon(100% 0, 100% 100%, 0 100%)')}
    </div>
  );
}

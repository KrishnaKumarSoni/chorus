import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Attachment, Conversation, ConversationSummary, IngestSource, Mode, ProviderStatus, Settings, Turn, TurnEvent } from '../../shared/types';

export interface Toast { id: number; text: string; kind: 'info' | 'error' }

interface State {
  conversations: ConversationSummary[];
  current?: Conversation;
  settings?: Settings;
  statuses: ProviderStatus[];
  busy: boolean;
  toasts: Toast[];
  settingsOpen: boolean;
}

interface Actions {
  refreshList(): Promise<void>;
  open(id: string): Promise<void>;
  create(mode?: Mode): Promise<void>;
  remove(id: string): Promise<void>;
  send(text: string, mode: Mode, attachments: Attachment[]): Promise<void>;
  cancel(): Promise<void>;
  setInstructions(text: string): Promise<void>;
  rename(title: string): Promise<void>;
  addReferences(sources: IngestSource[]): Promise<void>;
  removeReference(id: string): Promise<void>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  refreshStatus(): Promise<void>;
  toast(text: string, kind?: Toast['kind']): void;
  setSettingsOpen(open: boolean): void;
}

const Ctx = createContext<(State & Actions) | undefined>(undefined);

export function ChorusProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ conversations: [], statuses: [], busy: false, toasts: [], settingsOpen: false });
  const currentId = useRef<string | undefined>(undefined);
  const api = window.chorus;

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setState((s) => ({ ...s, toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) })), 5000);
  }, []);

  const refreshList = useCallback(async () => {
    const conversations = await api.conversations.list();
    setState((s) => ({ ...s, conversations }));
  }, [api]);

  const open = useCallback(async (id: string) => {
    const current = await api.conversations.get(id);
    currentId.current = id;
    setState((s) => ({ ...s, current, busy: false }));
  }, [api]);

  const reloadCurrent = useCallback(async () => {
    if (!currentId.current) return;
    const current = await api.conversations.get(currentId.current);
    setState((s) => ({ ...s, current }));
  }, [api]);

  useEffect(() => {
    (async () => {
      const [settings, conversations] = await Promise.all([api.settings.get(), api.conversations.list()]);
      setState((s) => ({ ...s, settings, conversations }));
      if (conversations[0]) await open(conversations[0].id);
      const statuses = await api.providers.status();
      const fresh = await api.settings.get();
      setState((s) => ({ ...s, statuses, settings: fresh }));
    })().catch((e) => toast((e as Error).message, 'error'));
  }, [api, open, toast]);

  useEffect(() => {
    return api.onTurnEvent((e: TurnEvent) => {
      if (e.conversationId !== currentId.current) {
        if (e.type === 'exchange-done') refreshList();
        return;
      }
      setState((s) => {
        if (!s.current) return s;
        const turns = [...s.current.turns];
        const patch = (id: string, f: (t: Turn) => Turn) => {
          const i = turns.findIndex((t) => t.id === id);
          if (i >= 0) turns[i] = f(turns[i]);
        };
        switch (e.type) {
          case 'turn-start':
            if (!turns.some((t) => t.id === e.turn.id)) turns.push(e.turn);
            return { ...s, busy: true, current: { ...s.current, turns } };
          case 'turn-delta':
            patch(e.turnId, (t) => ({ ...t, text: t.text + e.text }));
            return { ...s, current: { ...s.current, turns } };
          case 'turn-activity':
            patch(e.turnId, (t) => ({ ...t, activity: [...(t.activity ?? []), e.label] }));
            return { ...s, current: { ...s.current, turns } };
          case 'turn-done':
            patch(e.turn.id, () => e.turn);
            if (!turns.some((t) => t.id === e.turn.id)) turns.push(e.turn);
            return { ...s, current: { ...s.current, turns } };
          case 'exchange-done':
            return { ...s, busy: false };
          default:
            return s;
        }
      });
      if (e.type === 'exchange-done') {
        reloadCurrent();
        refreshList();
      }
    });
  }, [api, refreshList, reloadCurrent]);

  const actions: Actions = useMemo(
    () => ({
      refreshList,
      open,
      toast,
      async create(mode) {
        const c = await api.conversations.create(mode ?? state.settings?.defaultMode ?? 'solo');
        await refreshList();
        await open(c.id);
      },
      async remove(id) {
        await api.conversations.delete(id);
        const list = await api.conversations.list();
        setState((s) => ({ ...s, conversations: list, current: s.current?.id === id ? undefined : s.current }));
        if (currentId.current === id) {
          currentId.current = undefined;
          if (list[0]) await open(list[0].id);
        }
      },
      async send(text, mode, attachments) {
        if (!currentId.current) return;
        setState((s) => ({ ...s, busy: true }));
        await api.messages.send({ conversationId: currentId.current, text, mode, attachmentIds: attachments.map((a) => a.id) });
      },
      async cancel() {
        if (currentId.current) await api.messages.cancel(currentId.current);
      },
      async setInstructions(text) {
        if (!currentId.current) return;
        await api.conversations.setInstructions(currentId.current, text);
        setState((s) => (s.current ? { ...s, current: { ...s.current, instructions: text } } : s));
      },
      async rename(title) {
        if (!currentId.current) return;
        await api.conversations.rename(currentId.current, title);
        await reloadCurrent();
        await refreshList();
      },
      async addReferences(sources) {
        if (!currentId.current) return;
        await api.conversations.addReferences(currentId.current, sources);
        await reloadCurrent();
      },
      async removeReference(id) {
        if (!currentId.current) return;
        await api.conversations.removeReference(currentId.current, id);
        await reloadCurrent();
      },
      async saveSettings(patch) {
        const settings = await api.settings.set(patch);
        setState((s) => ({ ...s, settings }));
      },
      async refreshStatus() {
        const statuses = await api.providers.status(true);
        const settings = await api.settings.get();
        setState((s) => ({ ...s, statuses, settings }));
      },
      setSettingsOpen(open) {
        setState((s) => ({ ...s, settingsOpen: open }));
      },
    }),
    [api, open, refreshList, reloadCurrent, toast, state.settings?.defaultMode],
  );

  return <Ctx.Provider value={{ ...state, ...actions }}>{children}</Ctx.Provider>;
}

export function useChorus() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChorus outside provider');
  return v;
}

/** Convert dropped or pasted Files into ingest sources (path when available, else inline data). */
export async function filesToSources(files: File[]): Promise<IngestSource[]> {
  const out: IngestSource[] = [];
  for (const f of files) {
    const p = window.chorus.attachments.pathForFile(f);
    if (p) out.push({ name: f.name, path: p, mime: f.type || undefined });
    else {
      const buf = await f.arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const name = f.name && f.name !== 'image.png' ? f.name : `pasted-${Date.now()}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
      out.push({ name, dataBase64: btoa(bin), mime: f.type || undefined });
    }
  }
  return out;
}

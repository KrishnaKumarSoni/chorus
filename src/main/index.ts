import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
import { CHANNELS } from '../shared/api';
import type { Attachment, IngestSource, Mode, SendRequest, Settings, TurnEvent } from '../shared/types';
import { ConversationStore } from './store/conversationStore';
import { SettingsStore } from './store/settingsStore';
import { CapabilityCache } from './store/capabilityCache';
import { AttachmentService } from './attachments/service';
import { ClaudeAdapter } from './providers/claude';
import { CodexAdapter } from './providers/codex';
import { Orchestrator } from './orchestrator/orchestrator';
import type { Adapter } from './providers/types';
import type { ProviderStatus } from '../shared/types';

const isDev = !!process.env.ELECTRON_RENDERER_URL;

let win: BrowserWindow | undefined;

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(here, '../preload/index.mjs'), contextIsolation: true, sandbox: false },
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  if (isDev) win.loadURL(process.env.ELECTRON_RENDERER_URL!);
  else win.loadFile(path.join(here, '../renderer/index.html'));
}

async function boot() {
  if (process.env.CHORUS_USER_DATA) app.setPath('userData', process.env.CHORUS_USER_DATA);
  const root = app.getPath('userData');
  const store = new ConversationStore(path.join(root, 'conversations'));
  const settings = new SettingsStore(path.join(root, 'settings.json'));
  const caps = new CapabilityCache(path.join(root, 'capabilities.json'));
  const attachments = new AttachmentService(path.join(root, 'attachments'));
  await Promise.all([store.init(), settings.init(), caps.init(), attachments.init()]);

  const adapters: Record<'claude' | 'codex', Adapter> = { claude: new ClaudeAdapter(), codex: new CodexAdapter(path.join(root, 'codex-home')) };
  const emit = (e: TurnEvent) => win?.webContents.send(CHANNELS.turnEvent, e);
  const orchestrator = new Orchestrator({ store, settings, caps, attachments, adapters, workRoot: path.join(root, 'work'), emit });

  const pending = new Map<string, Attachment>();
  let statusCache: ProviderStatus[] | undefined;

  const providerStatus = async (refresh = false): Promise<ProviderStatus[]> => {
    if (statusCache && !refresh) return statusCache;
    const list = await Promise.all(Object.values(adapters).map((a) => a.status(refresh).catch((e) => ({ provider: a.provider, ok: false, detail: (e as Error).message, models: [] }))));
    // Seed capability windows from catalogs and pick defaults for unset models.
    const patch: Partial<Settings> = { models: { ...settings.get().models } };
    for (const s of list) {
      for (const m of s.models) if (m.contextWindow) await caps.seed(s.provider, m.id, m.contextWindow, m.maxOutputTokens);
      if (!patch.models![s.provider] && s.models.length) patch.models![s.provider] = (s.models.find((m) => m.isDefault) ?? s.models[0]).id;
    }
    await settings.set(patch);
    statusCache = list;
    return list;
  };

  ipcMain.handle(CHANNELS.convList, () => store.list());
  ipcMain.handle(CHANNELS.convCreate, (_e, mode: Mode) => store.create(mode));
  ipcMain.handle(CHANNELS.convGet, (_e, id: string) => store.get(id));
  ipcMain.handle(CHANNELS.convDelete, (_e, id: string) => store.delete(id));
  ipcMain.handle(CHANNELS.convInstructions, (_e, id: string, instructions: string) => store.update(id, (c) => void (c.instructions = instructions)));
  ipcMain.handle(CHANNELS.convRename, (_e, id: string, title: string) => store.update(id, (c) => void (c.title = title)));
  ipcMain.handle(CHANNELS.convAddRefs, async (_e, id: string, sources: IngestSource[]) => {
    const out: Attachment[] = [];
    for (const s of sources) {
      const att = await attachments.ingest(s);
      await store.addReference(id, att);
      out.push(att);
    }
    return out;
  });
  ipcMain.handle(CHANNELS.convRemoveRef, (_e, id: string, attachmentId: string) => store.removeReference(id, attachmentId));

  ipcMain.handle(CHANNELS.msgSend, async (_e, req: SendRequest) => {
    const atts = req.attachmentIds.map((id) => pending.get(id)).filter((a): a is Attachment => !!a);
    for (const a of atts) pending.delete(a.id);
    await providerStatus();
    orchestrator.send(req, atts).catch((err) => console.error('[send]', err));
    return { exchangeId: 'started' };
  });
  ipcMain.handle(CHANNELS.msgCancel, (_e, id: string) => orchestrator.cancel(id));

  ipcMain.handle(CHANNELS.attIngest, async (_e, sources: IngestSource[]) => {
    const out: Attachment[] = [];
    for (const s of sources) {
      const att = await attachments.ingest(s);
      pending.set(att.id, att);
      out.push(att);
    }
    return out;
  });
  ipcMain.handle(CHANNELS.attPick, async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths.map<IngestSource>((p) => ({ name: path.basename(p), path: p }));
  });
  ipcMain.handle(CHANNELS.attPreview, async (_e, id: string) => {
    const att = pending.get(id) ?? (await findAttachment(id));
    if (!att || att.kind !== 'image') return undefined;
    const data = await fs.readFile(att.storedPath);
    return `data:${att.mime};base64,${data.toString('base64')}`;
  });
  async function findAttachment(id: string): Promise<Attachment | undefined> {
    for (const s of await store.list()) {
      const c = await store.get(s.id);
      const hit = c?.references.find((r) => r.id === id) ?? c?.turns.flatMap((t) => t.attachments ?? []).find((a) => a.id === id);
      if (hit) return hit;
    }
    return undefined;
  }

  ipcMain.handle(CHANNELS.settingsGet, () => settings.get());
  ipcMain.handle(CHANNELS.settingsSet, (_e, patch: Partial<Settings>) => settings.set(patch));
  ipcMain.handle(CHANNELS.providersStatus, (_e, refresh?: boolean) => providerStatus(refresh));

  nativeTheme.themeSource = 'system';
  createWindow();
  providerStatus().catch((e) => console.error('[status]', e));
}

app.whenReady().then(boot);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { CHANNELS } from '../shared/api';
import type { ChorusApi } from '../shared/api';
import type { AuthEvent, TurnEvent } from '../shared/types';

const api: ChorusApi = {
  conversations: {
    list: () => ipcRenderer.invoke(CHANNELS.convList),
    create: (mode) => ipcRenderer.invoke(CHANNELS.convCreate, mode),
    get: (id) => ipcRenderer.invoke(CHANNELS.convGet, id),
    delete: (id) => ipcRenderer.invoke(CHANNELS.convDelete, id),
    setInstructions: (id, instructions) => ipcRenderer.invoke(CHANNELS.convInstructions, id, instructions),
    rename: (id, title) => ipcRenderer.invoke(CHANNELS.convRename, id, title),
    addReferences: (id, sources) => ipcRenderer.invoke(CHANNELS.convAddRefs, id, sources),
    removeReference: (id, attachmentId) => ipcRenderer.invoke(CHANNELS.convRemoveRef, id, attachmentId),
  },
  messages: {
    send: (req) => ipcRenderer.invoke(CHANNELS.msgSend, req),
    cancel: (id) => ipcRenderer.invoke(CHANNELS.msgCancel, id),
  },
  attachments: {
    ingest: (sources) => ipcRenderer.invoke(CHANNELS.attIngest, sources),
    pickFiles: () => ipcRenderer.invoke(CHANNELS.attPick),
    preview: (id) => ipcRenderer.invoke(CHANNELS.attPreview, id),
    pathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    },
  },
  settings: {
    get: () => ipcRenderer.invoke(CHANNELS.settingsGet),
    set: (patch) => ipcRenderer.invoke(CHANNELS.settingsSet, patch),
  },
  providers: {
    status: (refresh) => ipcRenderer.invoke(CHANNELS.providersStatus, refresh),
    limits: () => ipcRenderer.invoke(CHANNELS.providersLimits),
  },
  auth: {
    start: (provider) => ipcRenderer.invoke(CHANNELS.authStart, provider),
    cancel: (provider) => ipcRenderer.invoke(CHANNELS.authCancel, provider),
    completeManual: (provider, input) => ipcRenderer.invoke(CHANNELS.authManual, provider, input),
    signOut: (provider) => ipcRenderer.invoke(CHANNELS.authSignOut, provider),
  },
  onTurnEvent: (listener) => {
    const handler = (_: unknown, e: TurnEvent) => listener(e);
    ipcRenderer.on(CHANNELS.turnEvent, handler);
    return () => ipcRenderer.removeListener(CHANNELS.turnEvent, handler);
  },
  onAuthEvent: (listener) => {
    const handler = (_: unknown, e: AuthEvent) => listener(e);
    ipcRenderer.on(CHANNELS.authEvent, handler);
    return () => ipcRenderer.removeListener(CHANNELS.authEvent, handler);
  },
};

contextBridge.exposeInMainWorld('chorus', api);

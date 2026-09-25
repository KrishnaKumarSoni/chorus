import type { Attachment, AuthEvent, Conversation, ConversationSummary, IngestSource, Mode, Provider, ProviderLimits, ProviderStatus, SendRequest, Settings, TurnEvent } from './types';

/** The bridge exposed to the renderer as `window.chorus`. */
export interface ChorusApi {
  conversations: {
    list(): Promise<ConversationSummary[]>;
    create(mode: Mode): Promise<Conversation>;
    get(id: string): Promise<Conversation | undefined>;
    delete(id: string): Promise<void>;
    setInstructions(id: string, instructions: string): Promise<void>;
    rename(id: string, title: string): Promise<void>;
    addReferences(id: string, sources: IngestSource[]): Promise<Attachment[]>;
    removeReference(id: string, attachmentId: string): Promise<void>;
  };
  messages: {
    send(req: SendRequest): Promise<{ exchangeId: string }>;
    cancel(conversationId: string): Promise<void>;
  };
  attachments: {
    ingest(sources: IngestSource[]): Promise<Attachment[]>;
    pickFiles(): Promise<IngestSource[]>;
    /** data: URL for previews of images in app storage. */
    preview(attachmentId: string): Promise<string | undefined>;
    /** Absolute path of a dropped File (empty for pasted data). */
    pathForFile(file: File): string;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
  };
  providers: {
    status(refresh?: boolean): Promise<ProviderStatus[]>;
    /** Plan usage left for each signed-in provider. */
    limits(): Promise<ProviderLimits[]>;
  };
  auth: {
    /** Opens the provider's own consent page in the browser and finishes the flow in-app. */
    start(provider: Provider): Promise<void>;
    cancel(provider: Provider): Promise<void>;
    /** Fallback for when the browser cannot reach the loopback listener. */
    completeManual(provider: Provider, input: string): Promise<void>;
    signOut(provider: Provider): Promise<void>;
  };
  onTurnEvent(listener: (e: TurnEvent) => void): () => void;
  onAuthEvent(listener: (e: AuthEvent) => void): () => void;
}

export const CHANNELS = {
  convList: 'conv:list', convCreate: 'conv:create', convGet: 'conv:get', convDelete: 'conv:delete', convInstructions: 'conv:instructions', convRename: 'conv:rename',
  convAddRefs: 'conv:add-refs', convRemoveRef: 'conv:remove-ref',
  msgSend: 'msg:send', msgCancel: 'msg:cancel',
  attIngest: 'att:ingest', attPick: 'att:pick', attPreview: 'att:preview',
  settingsGet: 'settings:get', settingsSet: 'settings:set',
  providersStatus: 'providers:status', providersLimits: 'providers:limits',
  authStart: 'auth:start', authCancel: 'auth:cancel', authManual: 'auth:manual', authSignOut: 'auth:signout',
  turnEvent: 'turn:event', authEvent: 'auth:event',
} as const;

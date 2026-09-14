import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Attachment, Compaction, Conversation, ConversationSummary, HarnessSession, Mode, Provider, Turn } from '../../shared/types';

/**
 * One JSON file per conversation. Turns are append-only; writes are
 * serialised per conversation and done atomically (tmp + rename).
 */
export class ConversationStore {
  private cache = new Map<string, Conversation>();
  private writing = new Map<string, Promise<void>>();

  constructor(private readonly dir: string) {}

  private file(id: string) {
    return path.join(this.dir, `${id}.json`);
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async list(): Promise<ConversationSummary[]> {
    const names = (await fs.readdir(this.dir)).filter((n) => n.endsWith('.json'));
    const out: ConversationSummary[] = [];
    for (const n of names) {
      const c = await this.get(n.slice(0, -5));
      if (c) out.push({ id: c.id, title: c.title, updatedAt: c.updatedAt, mode: c.mode, turnCount: c.turns.length });
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async get(id: string): Promise<Conversation | undefined> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    try {
      const raw = await fs.readFile(this.file(id), 'utf8');
      const conv = JSON.parse(raw) as Conversation;
      this.cache.set(id, conv);
      return conv;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
  }

  async create(mode: Mode, title = 'New conversation'): Promise<Conversation> {
    const now = new Date().toISOString();
    const conv: Conversation = {
      id: randomUUID(), title, createdAt: now, updatedAt: now, instructions: '', references: [], turns: [], compactions: [], sessions: {}, mode,
    };
    this.cache.set(conv.id, conv);
    await this.persist(conv);
    return conv;
  }

  async delete(id: string): Promise<void> {
    this.cache.delete(id);
    await fs.rm(this.file(id), { force: true });
  }

  private locks = new Map<string, Promise<unknown>>();

  /** Apply a mutation and persist. Mutations must not reorder or remove turns. Updates to one conversation run one at a time. */
  async update(id: string, mutate: (c: Conversation) => void): Promise<Conversation> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const run = prev.then(() => this.updateUnlocked(id, mutate));
    this.locks.set(id, run.catch(() => undefined));
    return run;
  }

  private async updateUnlocked(id: string, mutate: (c: Conversation) => void): Promise<Conversation> {
    const current = await this.get(id);
    if (!current) throw new Error(`conversation ${id} not found`);
    const draft = structuredClone(current);
    mutate(draft);
    if (draft.turns.length < current.turns.length) throw new Error('turns are append-only');
    for (let i = 0; i < current.turns.length; i++) {
      if (draft.turns[i]?.id !== current.turns[i].id) throw new Error('turns are append-only');
    }
    draft.updatedAt = new Date().toISOString();
    this.cache.set(id, draft);
    await this.persist(draft);
    return draft;
  }

  async appendTurn(id: string, turn: Omit<Turn, 'index'>): Promise<Turn> {
    let created!: Turn;
    await this.update(id, (c) => {
      created = { ...turn, index: c.turns.length } as Turn;
      c.turns.push(created);
    });
    return created;
  }

  async patchTurn(id: string, turnId: string, patch: Partial<Turn>): Promise<Turn> {
    let out!: Turn;
    await this.update(id, (c) => {
      const t = c.turns.find((x) => x.id === turnId);
      if (!t) throw new Error(`turn ${turnId} not found`);
      Object.assign(t, patch, { id: t.id, index: t.index });
      out = t;
    });
    return out;
  }

  async addCompaction(id: string, compaction: Compaction): Promise<void> {
    await this.update(id, (c) => c.compactions.push(compaction));
  }

  async setSession(id: string, provider: Provider, session: HarnessSession | undefined): Promise<void> {
    await this.update(id, (c) => {
      if (session) c.sessions[provider] = session;
      else delete c.sessions[provider];
    });
  }

  async markSessionsStale(id: string): Promise<void> {
    await this.update(id, (c) => {
      for (const s of Object.values(c.sessions)) if (s) s.stale = true;
    });
  }

  async addReference(id: string, attachment: Attachment): Promise<void> {
    await this.update(id, (c) => {
      c.references.push({ ...attachment, addedAfterTurnIndex: c.turns.length - 1 });
    });
  }

  async removeReference(id: string, attachmentId: string): Promise<void> {
    await this.update(id, (c) => {
      c.references = c.references.filter((r) => r.id !== attachmentId);
      for (const s of Object.values(c.sessions)) if (s) s.stale = true;
    });
  }

  private persist(conv: Conversation): Promise<void> {
    const prev = this.writing.get(conv.id) ?? Promise.resolve();
    const next = prev.then(async () => {
      const target = this.file(conv.id);
      const tmp = `${target}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(conv, null, 2), 'utf8');
      await fs.rename(tmp, target);
    });
    this.writing.set(conv.id, next.catch(() => undefined));
    return next;
  }
}

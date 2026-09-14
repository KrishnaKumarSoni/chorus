import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Attachment, IngestSource } from '../../shared/types';
import { classify, extractText, mimeFor } from './extract';

export class AttachmentService {
  private textCache = new Map<string, string>();
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  /** Copy the source into app storage, classify it and extract text. Never throws on extraction failure. */
  async ingest(src: IngestSource): Promise<Attachment> {
    const id = randomUUID();
    const name = path.basename(src.name || 'file');
    const folder = path.join(this.dir, id);
    await fs.mkdir(folder, { recursive: true });
    const storedPath = path.join(folder, name);
    const buffer = src.path ? await fs.readFile(src.path) : Buffer.from(src.dataBase64 ?? '', 'base64');
    await fs.writeFile(storedPath, buffer);
    const kind = classify(name, src.mime);
    const att: Attachment = { id, name, mime: mimeFor(name, src.mime), size: buffer.length, storedPath, kind };
    try {
      const text = await extractText(kind, buffer);
      if (text !== undefined) {
        const textPath = path.join(folder, 'extracted.txt');
        await fs.writeFile(textPath, text, 'utf8');
        att.textPath = textPath;
        att.textChars = text.length;
        this.textCache.set(id, text);
      }
    } catch (e) {
      att.extractError = (e as Error).message;
    }
    return att;
  }

  /** Synchronous read for the pure context builder; preloaded via `warm`. */
  text(att: Attachment): string | undefined {
    return this.textCache.get(att.id);
  }

  async warm(atts: Attachment[]): Promise<void> {
    await Promise.all(
      atts.map(async (a) => {
        if (!a.textPath || this.textCache.has(a.id)) return;
        try {
          this.textCache.set(a.id, await fs.readFile(a.textPath, 'utf8'));
        } catch {
          /* missing sidecar: treated as no text */
        }
      }),
    );
  }

  async readBase64(att: Attachment): Promise<string> {
    return (await fs.readFile(att.storedPath)).toString('base64');
  }
}

import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classify } from './extract';
import { AttachmentService } from './service';

const fx = (n: string) => path.join(process.cwd(), 'tests/fixtures', n);

describe('classify', () => {
  it('maps extensions and mimes to kinds', () => {
    expect(classify('a.png')).toBe('image');
    expect(classify('clip', 'image/png')).toBe('image');
    expect(classify('a.pdf')).toBe('pdf');
    expect(classify('a.docx')).toBe('docx');
    expect(classify('a.xlsx')).toBe('sheet');
    expect(classify('a.md')).toBe('text');
    expect(classify('a.ts')).toBe('text');
    expect(classify('a.bin')).toBe('binary');
  });
});

describe('AttachmentService', () => {
  const svc = new AttachmentService(mkdtempSync(path.join(os.tmpdir(), 'chorus-att-')));
  it('ingests and extracts every supported kind identically from disk', async () => {
    await svc.init();
    const cases: Array<[string, string]> = [
      ['notes.md', 'usage-based'], ['plain.txt', 'hello plain'], ['data.csv', 'sku,price'], ['code.ts', 'export const'],
      ['pricing.xlsx', 'basic,9'], ['doc.docx', 'Strategy memo'], ['doc.pdf', 'PDF strategy text'],
    ];
    for (const [name, needle] of cases) {
      const att = await svc.ingest({ name, path: fx(name) });
      expect(att.extractError, name).toBeUndefined();
      expect(svc.text(att), name).toContain(needle);
      expect(att.textChars).toBeGreaterThan(0);
    }
  });
  it('keeps images without extraction and serves them as base64', async () => {
    const att = await svc.ingest({ name: 'pixel.png', path: fx('pixel.png') });
    expect(att.kind).toBe('image');
    expect(att.textPath).toBeUndefined();
    expect((await svc.readBase64(att)).startsWith('iVBOR')).toBe(true);
  });
  it('accepts pasted data and warms text from disk on a fresh instance', async () => {
    const att = await svc.ingest({ name: 'pasted.txt', dataBase64: Buffer.from('pasted body').toString('base64') });
    expect(svc.text(att)).toBe('pasted body');
    const cold = new AttachmentService(path.dirname(path.dirname(att.storedPath)));
    expect(cold.text(att)).toBeUndefined();
    await cold.warm([att]);
    expect(cold.text(att)).toBe('pasted body');
  });
});

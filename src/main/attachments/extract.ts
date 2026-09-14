import path from 'node:path';
import type { AttachmentKind } from '../../shared/types';

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.toml', '.xml', '.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.sh', '.zsh', '.sql', '.csv', '.tsv', '.log', '.ini', '.env', '.cfg', '.tex', '.rtf']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const SHEET_EXT = new Set(['.xlsx', '.xls', '.xlsm', '.ods']);

export function classify(name: string, mime?: string): AttachmentKind {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXT.has(ext) || mime?.startsWith('image/')) return 'image';
  if (ext === '.pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (SHEET_EXT.has(ext)) return 'sheet';
  if (TEXT_EXT.has(ext) || mime?.startsWith('text/')) return 'text';
  return 'binary';
}

export function mimeFor(name: string, fallback?: string): string {
  const ext = path.extname(name).toLowerCase();
  const table: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.md': 'text/markdown', '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
  };
  return table[ext] ?? fallback ?? 'application/octet-stream';
}

/** Extract readable text from a file buffer. Returns undefined for kinds with nothing to extract (images, binary). */
export async function extractText(kind: AttachmentKind, buffer: Buffer): Promise<string | undefined> {
  switch (kind) {
    case 'text':
      return buffer.toString('utf8');
    case 'pdf': {
      const mod = await import('pdf-parse/lib/pdf-parse.js');
      const pdf = (mod.default ?? mod) as (b: Buffer) => Promise<{ text: string; numpages: number }>;
      const r = await pdf(buffer);
      return r.text.trim();
    }
    case 'docx': {
      const mammoth = await import('mammoth');
      const r = await mammoth.extractRawText({ buffer });
      return r.value.trim();
    }
    case 'sheet': {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      return wb.SheetNames.map((n) => `## Sheet: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n\n').trim();
    }
    default:
      return undefined;
  }
}

import type { Attachment, Turn } from '../../shared/types';

export const PROVIDER_LABEL: Record<string, string> = { claude: 'Claude', codex: 'GPT (Codex)' };

export function authorLabel(turn: Turn): string {
  if (turn.role === 'user') return 'User';
  if (!turn.author) return 'Assistant';
  return `${PROVIDER_LABEL[turn.author.provider] ?? turn.author.provider} · ${turn.author.model}`;
}

function kindSuffix(turn: Turn): string {
  if (turn.role !== 'assistant' || turn.mode === 'solo') return '';
  const parts: string[] = [turn.mode];
  if (turn.kind) parts.push(turn.kind);
  if (turn.round) parts.push(`round ${turn.round}`);
  return ` [${parts.join(', ')}]`;
}

/** Render one turn as labelled transcript text. Attachments are referenced by name; their text is rendered separately. */
export function renderTurn(turn: Turn): string {
  const head = `### ${authorLabel(turn)}${kindSuffix(turn)}`;
  const body = turn.status === 'error'
    ? `(this reply failed: ${turn.error ?? 'unknown error'})`
    : turn.status === 'cancelled'
      ? `${turn.text}\n(reply was cancelled here)`
      : turn.text;
  const files = turn.attachments?.length
    ? `\n(attached: ${turn.attachments.map((a) => a.name).join(', ')})`
    : '';
  return `${head}\n${body}${files}`;
}

export function renderTranscript(turns: Turn[]): string {
  return turns.map(renderTurn).join('\n\n');
}

export interface ReferenceText {
  attachment: Attachment;
  text: string;
}

export interface RenderedReferences {
  text: string;
  truncated: string[]; // attachment ids that were cut
}

/**
 * Render extracted reference text inside a character budget. Files are cut
 * proportionally when they do not fit, and the cut is stated inline so the
 * model (and the user) know what is missing.
 */
export function renderReferences(refs: ReferenceText[], maxChars: number): RenderedReferences {
  if (refs.length === 0) return { text: '', truncated: [] };
  const total = refs.reduce((n, r) => n + r.text.length, 0);
  const truncated: string[] = [];
  const overhead = 120 * refs.length;
  const available = Math.max(0, maxChars - overhead);
  const scale = total > available ? available / total : 1;
  const parts = refs.map((r) => {
    const keep = scale < 1 ? Math.floor(r.text.length * scale) : r.text.length;
    let body = r.text;
    if (keep < r.text.length) {
      truncated.push(r.attachment.id);
      body = `${r.text.slice(0, keep)}\n[... truncated: ${keep} of ${r.text.length} characters shown ...]`;
    }
    return `<file name="${r.attachment.name}">\n${body}\n</file>`;
  });
  return { text: parts.join('\n\n'), truncated };
}

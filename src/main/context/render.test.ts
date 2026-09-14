import { describe, it, expect } from 'vitest';
import { renderTurn, renderTranscript, renderReferences } from './render';
import type { Turn, Attachment } from '../../shared/types';

const base = { exchangeId: 'e1', createdAt: 'now', status: 'done' as const, mode: 'solo' as const };
const user: Turn = { ...base, id: 'u', index: 0, role: 'user', text: 'Hello' };
const claude: Turn = { ...base, id: 'c', index: 1, role: 'assistant', text: 'Hi from Claude', author: { provider: 'claude', model: 'claude-opus-5' } };
const codex: Turn = { ...base, id: 'g', index: 2, role: 'assistant', text: 'Hi from GPT', author: { provider: 'codex', model: 'gpt-5.5' }, mode: 'consensus', kind: 'critique', round: 2 };

describe('render', () => {
  it('labels turns by author and mode', () => {
    expect(renderTurn(user)).toBe('### User\nHello');
    expect(renderTurn(claude)).toBe('### Claude · claude-opus-5\nHi from Claude');
    expect(renderTurn(codex)).toBe('### ChatGPT · gpt-5.5 [consensus, critique, round 2]\nHi from GPT');
  });
  it('names attachments and reports failed or cancelled replies', () => {
    const att = { id: 'a', name: 'notes.md' } as Attachment;
    expect(renderTurn({ ...user, attachments: [att] })).toContain('(attached: notes.md)');
    expect(renderTurn({ ...claude, status: 'error', error: 'boom' })).toContain('(this reply failed: boom)');
    expect(renderTurn({ ...claude, status: 'cancelled' })).toContain('cancelled');
  });
  it('joins a transcript', () => {
    expect(renderTranscript([user, claude]).split('\n\n')).toHaveLength(2);
  });
  it('renders references whole when they fit', () => {
    const r = renderReferences([{ attachment: { id: '1', name: 'a.txt' } as Attachment, text: 'abc' }], 10_000);
    expect(r.text).toBe('<file name="a.txt">\nabc\n</file>');
    expect(r.truncated).toEqual([]);
  });
  it('truncates proportionally and says so', () => {
    const refs = [
      { attachment: { id: '1', name: 'a.txt' } as Attachment, text: 'a'.repeat(1000) },
      { attachment: { id: '2', name: 'b.txt' } as Attachment, text: 'b'.repeat(3000) },
    ];
    const r = renderReferences(refs, 2000 + 240);
    expect(r.truncated).toEqual(['1', '2']);
    expect(r.text).toContain('[... truncated: 500 of 1000 characters shown ...]');
    expect(r.text).toContain('[... truncated: 1500 of 3000 characters shown ...]');
  });
});

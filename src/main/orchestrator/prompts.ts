import { AGREEMENT_MARKER } from '../../shared/consensus';
import type { DebatePrompts } from '../../shared/types';
import { DEFAULT_DEBATE_PROMPTS } from '../../shared/consensus';

export { DEFAULT_DEBATE_PROMPTS };

const CONVENTION = [
  `When you genuinely have nothing substantive left to add, end your message with ${AGREEMENT_MARKER} on its own final line.`,
  'Never use it just to be agreeable. If you still disagree on something that matters, say so plainly and leave it out.',
].join(' ');

function fill(template: string, fallback: string, otherName: string): string {
  const text = (template.trim() || fallback).replaceAll('{other}', otherName);
  return `${text}\n${CONVENTION}`;
}

/** First speaker in a consensus run: answer the user, knowing the other model will reply. */
export function consensusOpening(otherName: string, prompts: DebatePrompts = DEFAULT_DEBATE_PROMPTS): string {
  return fill(prompts.opening, DEFAULT_DEBATE_PROMPTS.opening, otherName);
}

/** Later speakers: continue the discussion naturally from the shared transcript. */
export function consensusContinue(otherName: string, prompts: DebatePrompts = DEFAULT_DEBATE_PROMPTS): string {
  return fill(prompts.reply, DEFAULT_DEBATE_PROMPTS.reply, otherName);
}

export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return 'New conversation';
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

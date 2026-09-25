import { AGREEMENT_MARKER } from '../../shared/consensus';
import type { DebatePrompts } from '../../shared/types';
import { DEFAULT_DEBATE_PROMPTS } from '../../shared/consensus';

export { DEFAULT_DEBATE_PROMPTS };

/** The fixed agreement rule, added to every critique turn. Openings never get it: there is nothing to agree with yet. */
const CONVENTION = [
  `Before you use ${AGREEMENT_MARKER}, actively look for the strongest reason the emerging shared answer could still be wrong.`,
  `End your message with ${AGREEMENT_MARKER} on its own final line only if no material objection survives and you endorse the core conclusion, reasoning, assumptions and important qualifications.`,
  'Do not signal agreement merely because the discussion feels repetitive or because the other model sounds convincing. Agreement between the two of you is not evidence by itself.',
].join(' ');

function fill(template: string, fallback: string, otherName: string): string {
  return (template.trim() || fallback).replaceAll('{other}', otherName);
}

/** Opening turn: answer independently, without seeing the other model's opening. */
export function consensusOpening(otherName: string, prompts: DebatePrompts = DEFAULT_DEBATE_PROMPTS): string {
  return fill(prompts.opening, DEFAULT_DEBATE_PROMPTS.opening, otherName);
}

/** Critique turns: continue the debate from the shared transcript, under the agreement rule. */
export function consensusContinue(otherName: string, prompts: DebatePrompts = DEFAULT_DEBATE_PROMPTS): string {
  return `${fill(prompts.reply, DEFAULT_DEBATE_PROMPTS.reply, otherName)}\n${CONVENTION}`;
}

export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return 'New conversation';
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

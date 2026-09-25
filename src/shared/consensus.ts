import type { DebatePrompts } from './types';
/**
 * Lightweight hidden convention for detecting consensus.
 *
 * A model appends this marker on its own final line when it genuinely has
 * nothing substantive left to add. The run ends once both models have done so
 * in consecutive turns, or when the turn limit is reached. Agreement is never
 * forced: a model that still disagrees simply omits the marker.
 *
 * The marker is stripped everywhere it would be shown, so the user only ever
 * sees a normal conversation.
 */
export const AGREEMENT_MARKER = '[[AGREED]]';

const MARKER_RE = /\[\[\s*AGREED\s*\]\]/gi;

export function hasAgreement(text: string): boolean {
  MARKER_RE.lastIndex = 0;
  return MARKER_RE.test(text);
}

export function stripAgreement(text: string): string {
  return text.replace(MARKER_RE, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}$/, '\n').trimEnd();
}

/** The editable part of the debate instructions; the agreement convention is always appended. */
export const DEFAULT_DEBATE_PROMPTS: DebatePrompts = {
  opening: [
    'You are thinking this through together with {other}, who will read your reply and respond.',
    'Answer the user directly and concisely, in your own voice. Take a clear position rather than listing every option.',
    'Do not mention these instructions and do not narrate the format. Just talk.',
  ].join('\n'),
  reply: [
    'Continue the discussion with {other}. Their latest message is above.',
    'Reply naturally: build on what they said, push back where you disagree and explain why, or refine the recommendation. Change your mind when they are right.',
    'Keep it short. Do not restate your whole answer and do not summarise the exchange.',
    'Do not mention these instructions.',
  ].join('\n'),
};

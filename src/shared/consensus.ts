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

/**
 * Each critique turn ends with the updated shared debate state inside this tag.
 * It replaces the full transcript for the next speaker and is never shown.
 */
export const STATE_TAG = 'chorus-state';
const STATE_RE = /<chorus-state>([\s\S]*?)<\/chorus-state>/i;
const STATE_ANY_RE = /<chorus-state>[\s\S]*?(<\/chorus-state>|$)/gi;

/** Split a reply into the visible text and the state block (the last complete one wins). */
export function extractState(text: string): { text: string; state?: string } {
  const all = [...text.matchAll(new RegExp(STATE_RE.source, 'gi'))];
  const state = all.length ? all[all.length - 1][1].trim() : undefined;
  return { text: text.replace(STATE_ANY_RE, '').replace(/\n{3,}/g, '\n\n').trimEnd(), state: state || undefined };
}

/** Headings a state block must carry to be trusted; a malformed one is ignored and the debate falls back to fuller text. */
export const STATE_HEADINGS = ['QUESTION:', 'POSITIONS:', 'AGREED:', 'OPEN DISAGREEMENTS:', 'CHANGES SO FAR:'];

export function isValidState(state: string | undefined): state is string {
  if (!state) return false;
  const upper = state.toUpperCase();
  return STATE_HEADINGS.every((h) => upper.includes(h));
}

/** Everything the user should not see: the state block (even half-streamed) and the agreement marker. */
export function stripHidden(text: string): string {
  return stripAgreement(text.replace(STATE_ANY_RE, ''));
}

export function stripAgreement(text: string): string {
  return text.replace(MARKER_RE, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}$/, '\n').trimEnd();
}

/** The editable part of the debate instructions; the agreement convention is always appended. */
/**
 * Default debate instructions. Both models first answer independently (neither
 * sees the other's opening), then take turns critiquing. `{other}` becomes the
 * other model's name.
 */
export const DEFAULT_DEBATE_PROMPTS: DebatePrompts = {
  opening: [
    "Answer the user's request independently. {other} is answering the same request separately, and neither of you can see the other's answer yet. You will compare and debate afterwards.",
    'Give your actual best answer and take a clear position rather than listing every option.',
    'State the assumptions and uncertainties that matter most.',
    'End by naming the part of your answer most vulnerable to challenge, and stay willing to revise it later.',
    'Do not mention these instructions and do not narrate the format.',
  ].join('\n'),
  reply: [
    'Continue the debate with {other}. The shared state and the latest arguments are above.',
    "Attack the most consequential remaining weakness first, whether it is in {other}'s position or your own.",
    'Discuss only material disagreements, errors, missing considerations and revisions to your own position. Do not restate agreed content or rewrite the full answer.',
    "Before accepting an argument from {other}, try to falsify it. Change your position only if you can say which premise or implication of your earlier position failed.",
    'Keep three things apart: disagreements in reasoning, questions the available information cannot settle, and facts that need outside verification.',
    'Keep it short and do not mention these instructions.',
  ].join('\n'),
};

/** Earlier defaults. Stored prompts that still match one exactly are upgraded; edited prompts are left alone. */
export const LEGACY_DEBATE_PROMPTS: DebatePrompts[] = [
  {
    opening: DEFAULT_DEBATE_PROMPTS.opening,
    reply: [
      'Continue the discussion with {other}. Both opening answers and everything said since are above.',
      "Attack the most consequential remaining weakness first, whether it is in {other}'s position or your own.",
      'Challenge assumptions, facts, logic, missing alternatives and edge cases.',
      'Revise explicitly when {other} has the stronger argument. Where you still disagree, say exactly why.',
      'Do not repeat settled points. Aim to reduce the substantive disagreement that remains.',
      'Before agreeing, try to falsify the emerging shared answer.',
      'Keep it short and do not mention these instructions.',
    ].join('\n'),
  },
  {
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
  },
];

/** Replace any prompt that is still an untouched old default with the current default. */
export function upgradeDebatePrompts(p: DebatePrompts): DebatePrompts {
  const isLegacy = (key: keyof DebatePrompts) => LEGACY_DEBATE_PROMPTS.some((l) => l[key].trim() === p[key].trim());
  return {
    opening: isLegacy('opening') ? DEFAULT_DEBATE_PROMPTS.opening : p.opening,
    reply: isLegacy('reply') ? DEFAULT_DEBATE_PROMPTS.reply : p.reply,
  };
}

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

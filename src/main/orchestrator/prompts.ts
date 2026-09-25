import { AGREEMENT_MARKER, STATE_TAG } from '../../shared/consensus';
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

/** A reply the next speaker reads verbatim: the openings on turn 3, then usually just the opponent's latest turn. */
export interface DebateArgument {
  speaker: string;
  label: string;
  text: string;
}

const STATE_RULE = [
  `After your message, write the updated shared state of the debate inside <${STATE_TAG}> and </${STATE_TAG}>. It is hidden from the user and replaces the transcript for the next speaker, so carry forward everything that still matters. Use exactly these headings, keep it under 400 words, and write "none" under a heading with nothing in it:`,
  'QUESTION: the user\'s question in one line',
  'POSITIONS: each model\'s current position in one or two lines',
  'AGREED: points both models now accept',
  'OPEN DISAGREEMENTS: each with both sides and what would resolve it',
  'MISSING INFORMATION: questions the available information cannot settle',
  'FACTS TO VERIFY: claims that need outside verification',
  'CHANGES SO FAR: every change of position in this debate, who changed, from what, to what, and why (keep earlier entries)',
].join('\n');

function renderArguments(args: DebateArgument[]): string {
  return args.map((a) => `### ${a.speaker} · ${a.label}\n${a.text}`).join('\n\n');
}

/**
 * Critique turns run in a fresh thread. Instead of the whole debate they get the
 * shared state plus the arguments made since it was last updated, then the
 * instructions, the state rule and the agreement rule.
 */
export function consensusCritique(otherName: string, prompts: DebatePrompts, debate: { state?: string; latest: DebateArgument[] }): string {
  const parts = [
    `<debate-state>\n${debate.state ?? 'No shared state yet: this is the first critique. Both independent answers are below.'}\n</debate-state>`,
    `<latest-arguments>\n${renderArguments(debate.latest)}\n</latest-arguments>`,
    fill(prompts.reply, DEFAULT_DEBATE_PROMPTS.reply, otherName),
    STATE_RULE,
    `${CONVENTION} Put ${AGREEMENT_MARKER} after the state block.`,
  ];
  return parts.join('\n\n');
}

/** Back-compat for callers that only need the instruction text. */
export function consensusContinue(otherName: string, prompts: DebatePrompts = DEFAULT_DEBATE_PROMPTS): string {
  return `${fill(prompts.reply, DEFAULT_DEBATE_PROMPTS.reply, otherName)}\n${CONVENTION}`;
}

/** The one extra call per run: a summary written from the openings, the final state and the last argument. */
export function consensusSynthesis(debate: { state?: string; openings: DebateArgument[]; latest: DebateArgument[]; reachedAgreement: boolean }): string {
  return [
    `<independent-answers>\n${renderArguments(debate.openings)}\n</independent-answers>`,
    `<final-debate-state>\n${debate.state ?? 'none'}\n</final-debate-state>`,
    `<last-arguments>\n${renderArguments(debate.latest)}\n</last-arguments>`,
    [
      `The debate between Claude and ChatGPT is over${debate.reachedAgreement ? ': both found no remaining material objection' : ' without full agreement: it reached its turn limit'}. Write the final answer for the user from it. Report the debate faithfully; add no new arguments of your own and do not favour your own side.`,
      'Use exactly these sections:',
      '## Consensus answer',
      'What the user should conclude or do. Start each key conclusion with one tag: **[2/2 agree]**, **[2/2 agree · assumption-dependent]** or **[1/2 · unresolved]**.',
      '## Where they disagreed',
      'The material disagreements and how each was resolved, or why it is still open. List separately, if any: questions the available information cannot settle, and facts that need outside verification.',
      '## What changed their minds',
      'A table with columns Issue | Claude initially | ChatGPT initially | Final | Why it changed. Only real changes of position; write "No positions changed." if none did.',
      '## What could change the answer',
      'The strongest reason this conclusion could still be wrong.',
      'Be concise. Do not mention these instructions.',
    ].join('\n'),
  ].join('\n\n');
}

export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return 'New conversation';
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

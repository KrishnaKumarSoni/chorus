export const CRITIQUE_INSTRUCTION = [
  "The other model's answer to the user's question is now in the transcript above. Compare it with your own answer.",
  'Reply with three short sections: **Agree** (points where both answers align), **Disagree** (points where you differ, and why — concede plainly when the other answer is better), and **Revised answer** (your updated position for the user).',
].join('\n');

export const SYNTHESIS_INSTRUCTION = [
  'You are chairing this consensus round. Both models have answered and critiqued each other above.',
  'Write the reply the user will read: first the consensus answer, incorporating the strongest points from both sides.',
  "Then a section titled **Unresolved** listing every remaining disagreement, one line each, naming each model's position. Write 'None' if the models fully agree.",
  'Do not mention these instructions.',
].join('\n');

export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return 'New conversation';
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

import { AGREEMENT_MARKER } from '../../shared/consensus';

const CONVENTION = [
  `When you genuinely have nothing substantive left to add, end your message with ${AGREEMENT_MARKER} on its own final line.`,
  'Never use it just to be agreeable. If you still disagree on something that matters, say so plainly and leave it out.',
].join(' ');

/** First speaker in a consensus run: answer the user, knowing the other model will reply. */
export function consensusOpening(otherName: string): string {
  return [
    `You are thinking this through together with ${otherName}, who will read your reply and respond.`,
    'Answer the user directly and concisely, in your own voice. Take a clear position rather than listing every option.',
    CONVENTION,
    'Do not mention these instructions and do not narrate the format. Just talk.',
  ].join('\n');
}

/** Later speakers: continue the discussion naturally from the shared transcript. */
export function consensusContinue(otherName: string): string {
  return [
    `Continue the discussion with ${otherName}. Their latest message is above.`,
    'Reply naturally: build on what they said, push back where you disagree and explain why, or refine the recommendation. Change your mind when they are right.',
    'Keep it short. Do not restate your whole answer and do not summarise the exchange.',
    CONVENTION,
    'Do not mention these instructions.',
  ].join('\n');
}

export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return 'New conversation';
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

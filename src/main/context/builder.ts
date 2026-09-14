import type { Attachment, Author, Capability, Conversation, HarnessSession, Turn } from '../../shared/types';
import { computeBudget, estimateImageTokens, estimateTextTokens } from './tokens';
import { renderReferences, renderTranscript, type ReferenceText } from './render';

export type PacketBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; attachment: Attachment };

export interface Packet {
  kind: 'resume' | 'fresh';
  system: string;
  blocks: PacketBlock[];
  estimatedTokens: number;
  budget: number;
  /** Fresh packet is over budget and older turns exist → orchestrator must compact then rebuild. */
  needsCompaction: boolean;
  /** Transcript index the session will have seen after this request succeeds. */
  syncedThroughTurnIndex: number;
  /** Every turn the session will have seen after this request (prior turns + the current one). */
  seenTurnIds: string[];
  referenceIds: string[];
  truncatedReferenceIds: string[];
  warnings: string[];
}

export interface BuildOptions {
  conversation: Conversation;
  target: Author;
  capability: Capability;
  globalInstructions: string;
  currentTurn: Turn;
  /** Extra instruction appended after the user's message (consensus rounds). */
  roundInstruction?: string;
  /** Replace the current message entirely (later consensus rounds: the user's text is already in the transcript). */
  messageOverride?: string;
  session?: HarnessSession;
  /** Whether the transport re-sends the system prompt on resume (Claude) or bakes it at session start (Codex). */
  resumeCarriesSystem: boolean;
  readText: (attachment: Attachment) => string | undefined;
}

export const PERSONA = [
  'You are taking part in Chorus, a desktop chat where the user can consult more than one AI model in the same conversation.',
  'The transcript may contain replies from another model, labelled with its name. Treat them as part of the shared conversation: build on them, correct them when they are wrong, and never pretend they are your own words.',
  'Reference files the user attached are provided as extracted text inside <file> tags, and images are attached directly. Both models receive the same material.',
  'When a section of history has been compacted, a <compacted-history> summary stands in for the original messages; treat its facts, decisions and open questions as established.',
].join('\n');

export function buildSystemPrompt(globalInstructions: string, chatInstructions: string): string {
  const parts = [PERSONA];
  if (globalInstructions.trim()) parts.push(`## User's standing instructions\n${globalInstructions.trim()}`);
  if (chatInstructions.trim()) parts.push(`## Instructions for this conversation\n${chatInstructions.trim()}`);
  return parts.join('\n\n');
}

export function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

const REFERENCE_SHARE = 0.35;

function isImage(a: Attachment): boolean {
  return a.kind === 'image';
}

function referenceTexts(refs: Attachment[], readText: BuildOptions['readText']): ReferenceText[] {
  const out: ReferenceText[] = [];
  for (const a of refs) {
    if (isImage(a)) continue;
    const text = readText(a);
    if (text && text.trim()) out.push({ attachment: a, text });
  }
  return out;
}

function estimateBlocks(blocks: PacketBlock[], calibration: number): number {
  let n = 0;
  for (const b of blocks) n += b.type === 'text' ? estimateTextTokens(b.text, calibration) : estimateImageTokens(1);
  return n;
}

function messageBlocks(turn: Turn, readText: BuildOptions['readText'], roundInstruction?: string, override?: string): PacketBlock[] {
  const blocks: PacketBlock[] = [];
  if (override !== undefined) {
    blocks.push({ type: 'text', text: override });
    return blocks;
  }
  const attachments = turn.attachments ?? [];
  const texts = referenceTexts(attachments, readText);
  if (texts.length) {
    const rendered = renderReferences(texts, Number.MAX_SAFE_INTEGER);
    blocks.push({ type: 'text', text: `<attachments>\n${rendered.text}\n</attachments>` });
  }
  for (const a of attachments) if (isImage(a)) blocks.push({ type: 'image', attachment: a });
  blocks.push({ type: 'text', text: turn.text });
  if (roundInstruction) blocks.push({ type: 'text', text: roundInstruction });
  return blocks;
}

export function buildPacket(opts: BuildOptions): Packet {
  const { conversation: conv, capability, currentTurn, session, readText } = opts;
  const budget = computeBudget(capability);
  const cal = capability.calibration || 1;
  const system = buildSystemPrompt(opts.globalInstructions, conv.instructions);
  const systemHash = hashString(system);
  const warnings: string[] = [];

  const priorTurns = conv.turns.filter((t) => t.id !== currentTurn.id && t.status !== 'streaming');
  const seenAfter = [...priorTurns.map((t) => t.id), currentTurn.id];
  const maxIndex = priorTurns.reduce((m, t) => Math.max(m, t.index), currentTurn.index);

  const canResume =
    !!session &&
    !session.stale &&
    session.model === opts.target.model &&
    (opts.resumeCarriesSystem || session.systemHash === systemHash);

  if (canResume && session) {
    const seen = new Set(session.seenTurnIds);
    const catchUp = priorTurns.filter((t) => !seen.has(t.id)).sort((a, b) => a.index - b.index);
    const newRefs = conv.references.filter((r) => !session.referenceIds.includes(r.id));
    const blocks: PacketBlock[] = [];
    if (catchUp.length) {
      blocks.push({
        type: 'text',
        text: `<transcript-catch-up>\nMessages exchanged since your last reply (including any from the other model):\n\n${renderTranscript(catchUp)}\n</transcript-catch-up>`,
      });
    }
    const truncated: string[] = [];
    if (newRefs.length) {
      const texts = referenceTexts(newRefs, readText);
      if (texts.length) {
        const rendered = renderReferences(texts, Math.floor(budget * REFERENCE_SHARE * 4));
        truncated.push(...rendered.truncated);
        blocks.push({ type: 'text', text: `<references added>\n${rendered.text}\n</references>` });
      }
      for (const a of newRefs) if (isImage(a)) blocks.push({ type: 'image', attachment: a });
    }
    blocks.push(...messageBlocks(currentTurn, readText, opts.roundInstruction, opts.messageOverride));
    const estimatedTokens = estimateBlocks(blocks, cal);
    if (estimatedTokens <= budget) {
      return {
        kind: 'resume',
        system,
        blocks,
        estimatedTokens,
        budget,
        needsCompaction: false,
        syncedThroughTurnIndex: maxIndex,
        seenTurnIds: seenAfter,
        referenceIds: conv.references.map((r) => r.id),
        truncatedReferenceIds: truncated,
        warnings,
      };
    }
    warnings.push('Catch-up did not fit the context budget; rebuilt the conversation from the canonical transcript.');
  }

  // Fresh packet: references + compacted history + verbatim turns + current message.
  const blocks: PacketBlock[] = [];
  const truncated: string[] = [];
  const refTexts = referenceTexts(conv.references, readText);
  if (refTexts.length) {
    const rendered = renderReferences(refTexts, Math.floor(budget * REFERENCE_SHARE * 4));
    truncated.push(...rendered.truncated);
    blocks.push({ type: 'text', text: `<references>\nFiles the user added to this conversation:\n\n${rendered.text}\n</references>` });
  }
  for (const a of conv.references) if (isImage(a)) blocks.push({ type: 'image', attachment: a });

  const latest = conv.compactions.length ? conv.compactions[conv.compactions.length - 1] : undefined;
  const verbatim = (latest ? priorTurns.filter((t) => t.index > latest.throughTurnIndex) : priorTurns).sort((a, b) => a.index - b.index);
  const history: string[] = [];
  if (latest) history.push(`<compacted-history through-turn="${latest.throughTurnIndex}">\n${latest.summary}\n</compacted-history>`);
  if (verbatim.length) history.push(`<history>\n${renderTranscript(verbatim)}\n</history>`);
  if (history.length) blocks.push({ type: 'text', text: history.join('\n\n') });

  blocks.push(...messageBlocks(currentTurn, readText, opts.roundInstruction, opts.messageOverride));
  const estimatedTokens = estimateBlocks(blocks, cal);
  const needsCompaction = estimatedTokens > budget && verbatim.length > 0;
  return {
    kind: 'fresh',
    system,
    blocks,
    estimatedTokens,
    budget,
    needsCompaction,
    syncedThroughTurnIndex: maxIndex,
    seenTurnIds: seenAfter,
    referenceIds: conv.references.map((r) => r.id),
    truncatedReferenceIds: truncated,
    warnings,
  };
}

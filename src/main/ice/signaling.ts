// TFAF messages relayed through the lobby server as IceMsg, besides the candidates. The Java adapter parses every
// IceMsg into its CandidatesMessage record and fails on anything else, so these go only to peers whose TFAF adapter
// announced Feature.signaling in its hello.

import { asObject, asString } from '../api/jsonApi.ts';

export type SignalKind = 'restart' | 'bye';

export interface SignalMessage {
  kind: SignalKind;
  sourceId: number;
  destinationId: number;
}

const SIGNAL_VERSION = 2;
const KINDS: readonly SignalKind[] = ['restart', 'bye'];
const MAX_SIGNAL_LENGTH = 200;

export function serializeSignal(message: SignalMessage): string {
  return JSON.stringify({ tfaf: SIGNAL_VERSION, kind: message.kind, srcId: message.sourceId, destId: message.destinationId });
}

/** A TFAF signal, or null for anything else, such as a candidates message. */
export function parseSignal(value: unknown): SignalMessage | null {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    if (value.length > MAX_SIGNAL_LENGTH || !value.includes('"tfaf"')) {
      return null;
    }
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const raw = asObject(parsed);
  const kind = asString(raw?.kind);
  const sourceId = raw?.srcId;
  const destinationId = raw?.destId;
  if (
    !raw ||
    raw.tfaf !== SIGNAL_VERSION ||
    !kind ||
    !KINDS.includes(kind as SignalKind) ||
    typeof sourceId !== 'number' ||
    !Number.isInteger(sourceId) ||
    typeof destinationId !== 'number' ||
    !Number.isInteger(destinationId)
  ) {
    return null;
  }
  return { kind: kind as SignalKind, sourceId, destinationId };
}

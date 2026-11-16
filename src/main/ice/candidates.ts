// ICE candidates and the candidate exchange format of the FAF Java ICE adapter: a JSON string with
// CandidatesMessage(srcId, destId, password, ufrag, candidates[]) relayed through the lobby server as IceMsg.

import net from 'node:net';
import { asObject, asString } from '../api/jsonApi.ts';

export type CandidateType = 'host' | 'srflx' | 'prflx' | 'relay';

export interface Candidate {
  type: CandidateType;
  address: string;
  port: number;
  priority: number;
  foundation: string;
  relatedAddress: string | null;
  relatedPort: number;
}

export interface IceParameters {
  ufrag: string;
  password: string;
  candidates: Candidate[];
}

export interface CandidatePolicy {
  host: boolean;
  reflexive: boolean;
  relay: boolean;
}

export const ALL_CANDIDATES: CandidatePolicy = { host: true, reflexive: true, relay: true };

export function isAllowed(policy: CandidatePolicy, type: CandidateType): boolean {
  switch (type) {
    case 'host':
      return policy.host;
    case 'srflx':
    case 'prflx':
      return policy.reflexive;
    case 'relay':
      return policy.relay;
  }
}

const TYPE_PREFERENCE: Record<CandidateType, number> = { host: 126, prflx: 110, srflx: 100, relay: 0 };
const COMPONENT_ID = 1;

/** RFC 8445, section 5.1.2.1. */
export function candidatePriority(type: CandidateType, localPreference: number): number {
  return TYPE_PREFERENCE[type] * 2 ** 24 + (localPreference & 0xffff) * 2 ** 8 + (256 - COMPONENT_ID);
}

/** Priority announced in connectivity checks: the candidate as the peer would learn it, as peer reflexive. */
export function peerReflexivePriority(candidate: Candidate): number {
  return TYPE_PREFERENCE.prflx * 2 ** 24 + (candidate.priority % 2 ** 24);
}

/** RFC 8445, section 6.1.2.3. */
export function pairPriority(controlling: number, controlled: number): bigint {
  const g = BigInt(controlling);
  const d = BigInt(controlled);
  return (1n << 32n) * (g < d ? g : d) + 2n * (g > d ? g : d) + (g > d ? 1n : 0n);
}

const JAVA_TYPES: Record<CandidateType, string> = {
  host: 'HOST_CANDIDATE',
  srflx: 'SERVER_REFLEXIVE_CANDIDATE',
  prflx: 'PEER_REFLEXIVE_CANDIDATE',
  relay: 'RELAYED_CANDIDATE',
};

const TYPES_BY_JAVA_NAME = new Map(Object.entries(JAVA_TYPES).map(([type, name]) => [name, type as CandidateType]));

export function serializeCandidatesMessage(sourceId: number, destinationId: number, parameters: IceParameters): string {
  const candidates = [...parameters.candidates]
    .sort((a, b) => b.priority - a.priority)
    .map((candidate, index) => ({
      foundation: candidate.foundation,
      protocol: 'udp',
      priority: candidate.priority,
      ip: candidate.address,
      port: candidate.port,
      type: JAVA_TYPES[candidate.type],
      generation: 0,
      id: String(index),
      relAddr: candidate.relatedAddress,
      relPort: candidate.relatedPort,
    }));
  return JSON.stringify({
    srcId: sourceId,
    destId: destinationId,
    password: parameters.password,
    ufrag: parameters.ufrag,
    candidates,
  });
}

const MAX_CANDIDATES = 64;
const MAX_CREDENTIAL_LENGTH = 256;

function credential(value: unknown): string | null {
  const text = asString(value);
  return text && text.length <= MAX_CREDENTIAL_LENGTH ? text : null;
}

function parseCandidate(value: unknown): Candidate | null {
  const raw = asObject(value);
  const type = TYPES_BY_JAVA_NAME.get(asString(raw?.type) ?? '');
  const address = asString(raw?.ip);
  const port = raw?.port;
  const priority = raw?.priority;
  // Generations other than 0 are dropped by the Java adapter as well.
  if (
    !raw ||
    !type ||
    asString(raw.protocol)?.toLowerCase() !== 'udp' ||
    !address ||
    !net.isIPv4(address) ||
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    typeof priority !== 'number' ||
    !Number.isInteger(priority) ||
    priority < 1 ||
    priority > 0xffffffff ||
    (raw.generation ?? 0) !== 0
  ) {
    return null;
  }
  const relatedAddress = asString(raw.relAddr);
  const relatedPort = raw.relPort;
  return {
    type,
    address,
    port,
    priority,
    foundation: (asString(raw.foundation) ?? '').slice(0, 32),
    relatedAddress: relatedAddress && net.isIPv4(relatedAddress) ? relatedAddress : null,
    relatedPort: typeof relatedPort === 'number' && Number.isInteger(relatedPort) ? relatedPort : 0,
  };
}

/**
 * Parses the IceMsg payload of a remote adapter. Candidates the local agent cannot use (IPv6, TCP) are skipped; a
 * message without credentials is rejected.
 */
export function parseCandidatesMessage(value: unknown): { sourceId: number; parameters: IceParameters } | null {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const raw = asObject(parsed);
  const sourceId = raw?.srcId;
  const ufrag = credential(raw?.ufrag);
  const password = credential(raw?.password);
  if (!raw || typeof sourceId !== 'number' || !Number.isInteger(sourceId) || !ufrag || !password) {
    return null;
  }
  const candidates = (Array.isArray(raw.candidates) ? raw.candidates.slice(0, MAX_CANDIDATES) : [])
    .map(parseCandidate)
    .filter((candidate): candidate is Candidate => candidate !== null);
  return { sourceId, parameters: { ufrag, password, candidates } };
}

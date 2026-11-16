// Which players of a lobby game lack a TFAF lobby feature of the game (lobbyFeatures.ts), and what follows. The host
// checks every player against its game: a player without a required feature is disconnected, one without an optional
// feature is only reported. A player checks the host's game against its own: a required feature its launcher cannot
// play makes it leave, and a game started unlike the host's (the host's features did not arrive before the start) is
// reported, since only joining again fixes it.

import type { LobbyFeatureIssue } from '../../shared/contract.ts';
import {
  type AnnouncedFeature,
  type FeatureAnnouncement,
  featureName,
  isKnownFeature,
  LOBBY_FEATURES,
  supportsFeature,
} from './lobbyFeatures.ts';

/** A player's launcher as its adapter came to know it. */
export type PeerLauncher =
  /** Another client, TFAF with the Java adapter or TFAF older than 0.6.0. */
  | { kind: 'other' }
  /** TFAF 0.6.0, which announces no features. */
  | { kind: 'legacy' }
  | { kind: 'tfaf'; announcement: FeatureAnnouncement };

export interface PlayerVerdict {
  action: 'none' | 'warn' | 'kick';
  /** The game's features the player lacks; for a kick only the required ones. */
  missing: AnnouncedFeature[];
}

function playsWith(player: PeerLauncher, feature: AnnouncedFeature): boolean {
  switch (player.kind) {
    case 'tfaf':
      return player.announcement.features.some((own) => own.id === feature.id);
    case 'legacy':
      return isKnownFeature(feature.id) && LOBBY_FEATURES[feature.id].legacy;
    case 'other':
      return false;
  }
}

/** Host: what the player's game lacks of ours. */
export function checkPlayer(game: FeatureAnnouncement, player: PeerLauncher): PlayerVerdict {
  const missing = game.features.filter((feature) => !playsWith(player, feature));
  const required = missing.filter((feature) => feature.required);
  if (required.length > 0) {
    return { action: 'kick', missing: required };
  }
  return { action: missing.length > 0 ? 'warn' : 'none', missing };
}

export interface HostComparison {
  /** Features of the host's game that this launcher cannot play. */
  unsupported: AnnouncedFeature[];
  /** Features our game was started without, or with, unlike the host's. */
  mismatched: AnnouncedFeature[];
}

/** Player: the host's game against ours. */
export function compareWithHost(host: FeatureAnnouncement, own: FeatureAnnouncement): HostComparison {
  const ownIds = new Set(own.features.map((feature) => feature.id));
  const hostIds = new Set(host.features.map((feature) => feature.id));
  return {
    unsupported: host.features.filter((feature) => !supportsFeature(feature)),
    mismatched: [
      ...host.features.filter((feature) => supportsFeature(feature) && !ownIds.has(feature.id)),
      ...own.features.filter((feature) => !hostIds.has(feature.id)),
    ],
  };
}

/** The checks of the running online game, one side of them: the host's or a player's. */
export class LobbyFeatureChecks {
  /** What our game was started with, which our adapter announces. */
  readonly own: FeatureAnnouncement;
  readonly hosting: boolean;
  private readonly issues = new Map<number, { key: string; issue: LobbyFeatureIssue }>();
  /** Player: what the host's game uses, as its launcher told before the start and then in the lobby. */
  private hostFeatures: FeatureAnnouncement | null;
  private hostKey: string | null = null;

  constructor(own: FeatureAnnouncement, hosting: boolean, hostFeatures: FeatureAnnouncement | null = null) {
    this.own = own;
    this.hosting = hosting;
    this.hostFeatures = hostFeatures;
    // What the player was told before the start is not news when the lobby repeats it.
    if (hostFeatures) {
      this.compareWithHost(hostFeatures);
    }
  }

  /** Host: a player's launcher became known; `fresh` when the outcome is new for the player, so it is reported once. */
  checkPlayer(playerId: number, login: string, launcher: PeerLauncher): PlayerVerdict & { fresh: boolean } {
    const verdict = checkPlayer(this.own, launcher);
    const key = `${verdict.action}:${verdict.missing.map((feature) => feature.id).join(',')}`;
    const fresh = this.issues.get(playerId)?.key !== key;
    if (verdict.action === 'none') {
      this.issues.delete(playerId);
    } else {
      this.issues.set(playerId, {
        key,
        issue: { playerId, login, features: verdict.missing.map(featureName), kicked: verdict.action === 'kick' },
      });
    }
    return { ...verdict, fresh };
  }

  /** The player left; a kicked one stays on the list, so the host sees why. */
  removePlayer(playerId: number): void {
    if (!this.issues.get(playerId)?.issue.kicked) {
      this.issues.delete(playerId);
    }
  }

  list(): LobbyFeatureIssue[] {
    return [...this.issues.values()].map(({ issue }) => issue).sort((a, b) => a.login.localeCompare(b.login));
  }

  /** Player: the host's adapter reported the host's game; null when nothing changed since the last report. */
  compareWithHost(host: FeatureAnnouncement): HostComparison | null {
    this.hostFeatures = host;
    const comparison = compareWithHost(host, this.own);
    const key = JSON.stringify([comparison.unsupported, comparison.mismatched].map((list) => list.map((feature) => feature.id)));
    if (key === this.hostKey) {
      return null;
    }
    this.hostKey = key;
    return comparison;
  }

  /**
   * Player: the host disconnected us for lacking these features. `unsupported` when our launcher cannot play one of
   * them, so only an update helps; otherwise our game was merely started without them.
   */
  kickedFor(ids: readonly string[]): { features: AnnouncedFeature[]; unsupported: boolean } {
    const features = ids.map(
      (id) => this.hostFeatures?.features.find((feature) => feature.id === id) ?? { id, minVersion: '0.0.0', required: true, names: {} },
    );
    return { features, unsupported: features.some((feature) => !supportsFeature(feature)) };
  }
}

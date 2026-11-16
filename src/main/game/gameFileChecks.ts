import type { GameFilesReport, GamePeer, LobbyGame } from '../../shared/contract.ts';
import { compareWithHost, differenceKeys, type GameFingerprint, modKey, type PlayerFingerprint } from './fingerprint.ts';

/** The fingerprints the players of the running online game sent, for comparing everyone's files with the host's. */
export class GameFileChecks {
  /** From the lobby's HostGame or JoinGame command; until then the lobby's game info names the host. */
  hostLogin: string | null = null;
  private self: PlayerFingerprint;
  private readonly peers = new Map<number, PlayerFingerprint>();
  /** Our sim mods by modKey, to name a mod that differs. */
  private readonly modNames: Map<string, string>;
  /** Differences the alarm already sounded for. */
  private readonly announced = new Set<string>();

  constructor(self: PlayerFingerprint, mods: readonly { uid: string; name: string }[]) {
    this.self = self;
    this.modNames = new Map(mods.map((mod) => [modKey(mod.uid), mod.name]));
  }

  get ownFingerprint(): GameFingerprint | null {
    return this.self.fingerprint;
  }

  /** Our files changed with the game's lobby (lobbyFiles.ts). */
  setOwn(fingerprint: GameFingerprint, mods: readonly { uid: string; name: string }[]): void {
    this.self = { ...this.self, fingerprint };
    for (const mod of mods) {
      this.modNames.set(modKey(mod.uid), mod.name);
    }
  }

  setPeer(fingerprint: PlayerFingerprint): void {
    this.peers.set(fingerprint.playerId, fingerprint);
  }

  removePeer(playerId: number): void {
    this.peers.delete(playerId);
    // A player who comes back with the same files sounds the alarm again.
    for (const key of [...this.announced].filter((announced) => announced.startsWith(`${playerId}:`))) {
      this.announced.delete(key);
    }
  }

  /** Every player's files against the host's; `fresh` when a difference showed up that was not announced before. */
  compare(peers: readonly GamePeer[], lobbyGame: LobbyGame | null): { files: GameFilesReport; fresh: boolean } {
    const players = [
      this.self,
      ...peers.map((peer) => this.peers.get(peer.playerId) ?? { playerId: peer.playerId, login: peer.login, fingerprint: null }),
    ];
    // The lobby's mods follow what the host ticks in the game, so each change of the game's info compares again.
    const files = compareWithHost(this.hostLogin ?? lobbyGame?.host ?? null, players, this.modNames, lobbyGame?.simMods ?? null);
    const fresh = [...differenceKeys(files)].filter((key) => !this.announced.has(key));
    for (const key of fresh) {
      this.announced.add(key);
    }
    return { files, fresh: fresh.length > 0 };
  }
}

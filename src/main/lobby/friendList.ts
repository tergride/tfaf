import type { Friend, FoundPlayer, FriendsState, ServerId } from '../../shared/contract.ts';
import type { FafApi } from '../api/fafApi.ts';
import { asString, resolveDocument } from '../api/jsonApi.ts';
import { rsqlIn } from '../api/rsql.ts';
import { describeError } from '../errors.ts';
import { displayedRating } from './lobbyProtocol.ts';
import type { LobbyService } from './lobbyService.ts';

const IDS_PER_REQUEST = 100;
const RETRY_AFTER_FAILURE_MS = 60_000;
// After a login the server drops its players and sends them again at once; the wait keeps friends from blinking offline.
const UPDATE_DELAY_MS = 250;
const FOUND_PLAYERS = 20;

export interface FriendListDependencies {
  lobby: Pick<LobbyService, 'getSocial' | 'getPlayer' | 'getSelf' | 'findPlayers' | 'onSocialChanged' | 'onPlayersChanged'>;
  api: Pick<FafApi, 'getAll'>;
  /** Player ids of the test server are not those of the main one. */
  server: () => ServerId;
  onState: (state: FriendsState) => void;
}

/**
 * The friend list for the renderer. The lobby server sends only the ids of friends and the players who are online, so
 * the logins of friends who are offline come from the API, once per friend and server.
 */
export class FriendList {
  private readonly deps: FriendListDependencies;
  private readonly logins = new Map<number, string>();
  /** Asked of the API already: an account it does not return is not asked for again. */
  private readonly lookedUp = new Set<number>();
  private loginsServer: ServerId | null = null;
  private loading = false;
  private failedAt: number | null = null;
  private sent = '';
  private timer: NodeJS.Timeout | null = null;

  constructor(deps: FriendListDependencies) {
    this.deps = deps;
    deps.lobby.onSocialChanged(() => this.schedule());
    deps.lobby.onPlayersChanged((playerIds) => {
      const { friends } = deps.lobby.getSocial();
      if (playerIds === null || [...playerIds].some((id) => friends.has(id))) {
        this.schedule();
      }
    });
  }

  getState(): FriendsState {
    return this.build();
  }

  find(query: string): FoundPlayer[] {
    const text = query.trim().toLowerCase();
    if (!text) {
      return [];
    }
    const { lobby } = this.deps;
    const { friends } = lobby.getSocial();
    const selfId = lobby.getSelf()?.id;
    return lobby
      .findPlayers(text, FOUND_PLAYERS + 1)
      .filter((player) => player.id !== selfId)
      .slice(0, FOUND_PLAYERS)
      .map(({ id, login, clan, country }) => ({ id, login, clan, country, friend: friends.has(id) }));
  }

  private schedule(): void {
    this.timer ??= setTimeout(() => {
      this.timer = null;
      this.update();
    }, UPDATE_DELAY_MS);
  }

  private update(): void {
    const state = this.build();
    const text = JSON.stringify(state);
    if (text !== this.sent) {
      this.sent = text;
      this.deps.onState(state);
    }
    void this.loadLogins(state.friends);
  }

  private build(): FriendsState {
    this.forgetOtherServer();
    const { lobby } = this.deps;
    const friends = [...lobby.getSocial().friends].map((id): Friend => {
      const player = lobby.getPlayer(id);
      if (!player) {
        return { id, login: this.logins.get(id) ?? null, online: false, clan: null, country: null, rating: null, avatar: null };
      }
      this.logins.set(id, player.login);
      return {
        id,
        login: player.login,
        online: true,
        clan: player.clan,
        country: player.country,
        rating: displayedRating(player.ratings.get('global')),
        avatar: player.avatar,
      };
    });
    return { friends };
  }

  private forgetOtherServer(): void {
    const server = this.deps.server();
    if (server !== this.loginsServer) {
      this.loginsServer = server;
      this.logins.clear();
      this.lookedUp.clear();
      this.failedAt = null;
    }
  }

  private async loadLogins(friends: readonly Friend[]): Promise<void> {
    if (this.loading || (this.failedAt !== null && Date.now() - this.failedAt < RETRY_AFTER_FAILURE_MS)) {
      return;
    }
    const missing = friends.filter((friend) => friend.login === null && !this.lookedUp.has(friend.id)).map((friend) => friend.id);
    if (missing.length === 0) {
      return;
    }
    const server = this.deps.server();
    this.loading = true;
    let learned = false;
    try {
      for (let start = 0; start < missing.length; start += IDS_PER_REQUEST) {
        const ids = missing.slice(start, start + IDS_PER_REQUEST);
        const document = await this.deps.api.getAll('/data/player', { filter: rsqlIn('id', ids), 'fields[player]': 'login' });
        if (server !== this.deps.server()) {
          return;
        }
        for (const item of resolveDocument(document).items) {
          const id = Number(item.id);
          const login = asString(item.login);
          if (login && Number.isSafeInteger(id)) {
            this.logins.set(id, login);
            learned = true;
          }
        }
        ids.forEach((id) => this.lookedUp.add(id));
      }
      this.failedAt = null;
    } catch (error) {
      this.failedAt = Date.now();
      console.warn('Logins of offline friends could not be loaded', describeError(error));
    } finally {
      this.loading = false;
    }
    if (learned) {
      this.schedule();
    }
  }
}

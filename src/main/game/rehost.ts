// A hosted game created again with other mods. A game mounts its mods only when it starts (gameVault.ts), and the
// FAF lobby lets the host tick only the mods every player's game has mounted, so the host adds mods by starting over:
// it changes them in the launcher, its launcher tells the TFAF players (tfafProtocol.ts `rehost`), closes the game and
// hosts it again with the new mods. The players' launchers download the mods, close their games and join the host's
// new game. Ticking mods in the game's lobby needs none of this: the launchers check the newly ticked mods
// (lobbyFiles.ts), and the players compare their files for the ticked mods only (fingerprint.ts `compareWithHost`).

import { t } from '../i18n.ts';
import type { RawGame } from '../lobby/lobbyProtocol.ts';
import type { LobbyService } from '../lobby/lobbyService.ts';

/** How long a player waits for the host's new game: the host checks its files and starts the game first. */
export const REHOST_WAIT_MS = 3 * 60 * 1000;

export function sameMods(a: string[], b: string[]): boolean {
  return [...new Set(a)].sort().join(' ') === [...new Set(b)].sort().join(' ');
}

/** Waits for the host's new game, up to REHOST_WAIT_MS; an abort of `signal` stops waiting without an answer. */
export function waitForRehostedGame(
  lobby: Pick<LobbyService, 'getRawGames' | 'onGameChanged'>,
  hostLogin: string,
  previousId: number,
  signal: AbortSignal,
): Promise<RawGame> {
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      unsubscribe();
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
    };
    const check = (): void => {
      const game = findRehostedGame(lobby.getRawGames(), hostLogin, previousId);
      if (game) {
        finish();
        resolve(game);
      }
    };
    const unsubscribe = lobby.onGameChanged(check);
    const timer = setTimeout(() => {
      finish();
      reject(new Error(t('main.game.rehostTimeout', { host: hostLogin })));
    }, REHOST_WAIT_MS);
    signal.addEventListener('abort', finish, { once: true });
    check();
  });
}

/** The host's new game: open, created after the one it closed, the latest of the host's. */
export function findRehostedGame(games: Iterable<RawGame>, hostLogin: string, previousId: number): RawGame | null {
  const host = hostLogin.toLowerCase();
  let found: RawGame | null = null;
  for (const game of games) {
    if (game.id > previousId && game.state === 'open' && game.host.toLowerCase() === host && (!found || game.id > found.id)) {
      found = game;
    }
  }
  return found;
}

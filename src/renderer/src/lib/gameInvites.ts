import type { GameSessionState } from '../../../shared/contract.ts';

type InviteSession = Pick<GameSessionState, 'kind' | 'gameId' | 'phase'> & {
  current: { launched: boolean; lobbyGame: { gameType: string } | null } | null;
};

/**
 * We are in a custom or coop game that is still in its lobby, Forged Alliance's or a TFAF room, so friends can be
 * invited into it. The launcher checks the rest when an invitation goes out.
 */
export function canInviteToGame(state: InviteSession): boolean {
  const current = state.current;
  return (
    state.kind === 'online' &&
    state.gameId !== null &&
    (state.phase === 'running' || state.phase === 'lobby') &&
    current !== null &&
    !current.launched &&
    current.lobbyGame?.gameType !== 'matchmaker'
  );
}

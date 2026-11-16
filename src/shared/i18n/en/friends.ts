import type { Messages } from '../ru.ts';

export const friends: Messages['friends'] = {
  title: 'Friends',
  buttonHint: 'Friends online: {online} of {total}',
  summary: 'Online: {online} of {total}',
  search: 'Find a friend or a player by nickname',
  noLobby: 'No connection to the server, so it is unknown which friends are online',
  groups: {
    playing: 'In a game',
    lobby: 'In a lobby',
    online: 'Online',
    offline: 'Offline',
  },
  unknownLogin: 'Player #{id}',
  empty: 'No friends yet. Find a player by nickname, or add one from the chat’s user list.',
  noFriendsFound: 'No friends match',
  found: 'Players online',
  noneOnline: 'Nobody online with that nickname',
  add: 'Add as a friend',
  addLogin: 'Add {login} as a friend',
};

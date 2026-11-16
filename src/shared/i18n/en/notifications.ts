import type { Messages } from '../ru.ts';

export const notifications: Messages['notifications'] = {
  title: 'Notifications',
  empty: 'No notifications yet',
  clear: 'Clear',
  dismiss: 'Dismiss',
  close: 'Close',
  actionFailed: 'The action failed: {error}',
  taskbarBadge: 'Unread: {count}',
  sources: {
    server: 'Server message',
    game: 'Game',
    chat: 'Chat',
    matchmaker: 'Matchmaker',
  },
  gameTitle: '“{title}”',
  untitledGame: 'Untitled',
  friends: {
    online: '{login} is online',
    offline: '{login} went offline',
    joinedGame: '{login} joined a game lobby',
    startedPlaying: '{login} is in a game',
  },
  gameFull: {
    title: 'All slots are taken',
    body: 'The game can start',
  },
  gameEnded: {
    title: 'The game is over',
    body: 'Rate the game. Your review will be visible to everyone in the replay vault',
    review: 'Rate',
  },
  gameFailed: {
    title: 'The game ended with an error',
    minimized:
      'The game was minimized. In fullscreen mode, minimizing or Alt+Tab can cause the game to crash, so windowed mode is recommended.',
    sound:
      'The game log contains XACT sound system errors. They are usually caused by Windows sound settings or third-party audio software. Solutions are described on the FAF forum.',
    openLog: 'Open log',
    moreInfo: 'More info',
  },
  replayFile: {
    failed: 'Could not open the replay',
    missing: 'File not found: {file}',
  },
  update: {
    title: 'Update {version} downloaded',
    body: 'The update will be installed when the launcher restarts.',
    restart: 'Restart',
  },
};

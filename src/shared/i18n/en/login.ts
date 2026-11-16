import type { Messages } from '../ru.ts';

export const login: Messages['login'] = {
  title: 'Sign in to TFAF',
  subtitle: 'Custom games, maps and mods on the FAF servers. A FAF account is required to sign in.',
  confirmInBrowser: 'The FAF sign-in page has opened in your browser. Confirm the sign-in on that page. If it asks for a code, enter:',
  copy: 'Copy',
  copied: 'Copied',
  reopenPage: 'Open the sign-in page again',
  codeExpires: 'The code is valid until {time}. This window updates automatically once the sign-in is confirmed.',
  waiting: 'Waiting for confirmation…',
  retrying: 'No connection to the FAF server. Reconnecting…',
  restoring: 'Restoring the session…',
  nextAttempt: 'Next attempt in {seconds} s.',
  server: 'Server',
  testServerHint: 'faforever.xyz, for testing',
  rememberMe: 'Remember the sign-in on this computer',
  signIn: 'Sign in with FAF',
  skirmish: 'Play without the server',
  skirmishHint: 'Skirmish against the AI on the FAF files already installed, without signing in or updating',
};

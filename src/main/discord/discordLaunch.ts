// Lets Discord start the launcher for a join from a friend's status, as discord-rpc's Discord_Register does: Discord
// opens `discord-<application id>://`, Windows starts the launcher for it, and the join itself comes over the IPC pipe
// once the launcher has connected to Discord. The key under HKCU\Software\Classes stays after an uninstall.

import { app } from 'electron';
import { describeError } from '../errors.ts';

export function setDiscordLaunch(applicationId: string, launchable: boolean): void {
  // A development build would register electron.exe, which does not start the launcher by itself.
  if (!app.isPackaged) {
    return;
  }
  const scheme = `discord-${applicationId}`;
  try {
    // The check compares the registered command with this executable, so a moved launcher registers itself again.
    const registered = app.isDefaultProtocolClient(scheme);
    if (launchable && !registered) {
      const done = app.setAsDefaultProtocolClient(scheme);
      console.info(done ? `Discord may now start the launcher (${scheme})` : `Discord launch could not be registered (${scheme})`);
    } else if (!launchable && registered) {
      app.removeAsDefaultProtocolClient(scheme);
      console.info(`Discord no longer starts the launcher (${scheme})`);
    }
  } catch (error) {
    console.warn('Discord launch registration failed', describeError(error));
  }
}

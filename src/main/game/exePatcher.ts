import { open } from 'node:fs/promises';
import { t } from '../i18n.ts';

// Offsets of the game version inside ForgedAlliance.exe, the same as ForgedAllianceExePatcher in faf-java-commons.
// The version is stored as a little-endian 32-bit integer at every offset.
const VERSION_ADDRESSES = [0xd3d40, 0x47612d, 0x476666];

export async function readExeVersion(exePath: string): Promise<number> {
  const handle = await open(exePath, 'r');
  try {
    const buffer = Buffer.alloc(4);
    const { bytesRead } = await handle.read(buffer, 0, 4, VERSION_ADDRESSES[0]);
    if (bytesRead !== 4) {
      throw new Error(t('main.game.exeCorrupted'));
    }
    return buffer.readInt32LE(0);
  } finally {
    await handle.close();
  }
}

export async function patchExeVersion(exePath: string, version: number): Promise<void> {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(version, 0);
  const handle = await open(exePath, 'r+');
  try {
    for (const address of VERSION_ADDRESSES) {
      await handle.write(buffer, 0, 4, address);
    }
  } finally {
    await handle.close();
  }
}

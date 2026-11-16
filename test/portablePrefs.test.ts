import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PortablePrefsBridge } from '../src/main/game/portablePrefs.ts';
import { updateGamePrefs } from '../src/main/vault/gamePrefs.ts';

const NAME = 'TFAF-portable-12345678-1234-1234-1234-123456789abc.prefs';

async function fixture(run: (paths: { canonical: string; system: string; journal: string; working: string }) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tfaf-portable-prefs-test-'));
  const canonical = path.join(directory, 'portable', 'TFAF.prefs');
  const system = path.join(directory, 'windows-prefs');
  await mkdir(path.dirname(canonical));
  await mkdir(system);
  try {
    await run({ canonical, system, journal: `${canonical}.session.json`, working: path.join(system, NAME) });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function pending(file: string, directory: string, phase = 'ready', name = NAME): Promise<void> {
  await writeFile(file, JSON.stringify({ version: 1, phase, name, directory, machine: 'test-machine' }));
}

describe('portable game preferences', () => {
  it('round-trips exact bytes through a unique engine filename without touching installed profiles', async () => {
    await fixture(async ({ canonical, system, journal }) => {
      const original = Buffer.from([112, 114, 111, 102, 105, 108, 101, 61, 233]);
      await writeFile(canonical, original);
      await writeFile(path.join(system, 'Game.prefs'), 'official');
      await writeFile(path.join(system, 'TFAF.prefs'), 'installed');
      const bridge = new PortablePrefsBridge(canonical, system, async () => false, 'test-machine');
      const session = await bridge.prepare();
      assert.match(session.argument, /^TFAF-portable-[a-f\d-]+\.prefs$/);
      assert.equal(session.argument, path.basename(session.workingFile));
      assert.deepEqual(await readFile(session.workingFile), original);
      await assert.rejects(updateGamePrefs(canonical, () => 'must not replace the running profile'));
      const changed = Buffer.concat([original, Buffer.from('\nchanged = true\n')]);
      await writeFile(session.workingFile, changed);
      await writeFile(`${session.workingFile}.new`, 'leftover');
      await session.finish();
      await session.finish();
      assert.deepEqual(await readFile(canonical), changed);
      assert.equal(await readFile(path.join(system, 'Game.prefs'), 'utf8'), 'official');
      assert.equal(await readFile(path.join(system, 'TFAF.prefs'), 'utf8'), 'installed');
      await assert.rejects(readFile(journal), { code: 'ENOENT' });
      await assert.rejects(readFile(session.workingFile), { code: 'ENOENT' });
      await assert.rejects(readFile(`${session.workingFile}.new`), { code: 'ENOENT' });
      await updateGamePrefs(canonical, () => 'unlocked');
      assert.equal(await readFile(canonical, 'utf8'), 'unlocked');
    });
  });

  it('cancels a failed game spawn without copying a working file back', async () => {
    await fixture(async ({ canonical, system, journal }) => {
      await writeFile(canonical, 'original');
      const session = await new PortablePrefsBridge(canonical, system, async () => false, 'test-machine').prepare();
      await writeFile(session.workingFile, 'not a started game');
      await session.cancel();
      assert.equal(await readFile(canonical, 'utf8'), 'original');
      await assert.rejects(readFile(journal), { code: 'ENOENT' });
      await updateGamePrefs(canonical, () => 'unlocked');
    });
  });

  it('releases the session and write lock when preparing the engine directory fails', async () => {
    await fixture(async ({ canonical, system, journal }) => {
      await writeFile(canonical, 'original');
      await rm(system, { recursive: true });
      await writeFile(system, 'a file blocks the directory');
      const bridge = new PortablePrefsBridge(canonical, system, async () => false, 'test-machine');
      await assert.rejects(bridge.prepare());
      await assert.rejects(readFile(journal), { code: 'ENOENT' });
      await updateGamePrefs(canonical, () => 'editable after preparation failure');
      await rm(system);
      const session = await bridge.prepare();
      assert.equal(await readFile(session.workingFile, 'utf8'), 'editable after preparation failure');
      await session.cancel();
    });
  });

  it('accepts a first game profile and preserves absence when the game wrote nothing', async () => {
    await fixture(async ({ canonical, system }) => {
      const bridge = new PortablePrefsBridge(canonical, system, async () => false, 'test-machine');
      const empty = await bridge.prepare();
      await empty.finish();
      await assert.rejects(readFile(canonical), { code: 'ENOENT' });
      const first = await bridge.prepare();
      await writeFile(first.workingFile, 'new profile');
      await first.finish();
      assert.equal(await readFile(canonical, 'utf8'), 'new profile');
    });
  });

  // Forged Alliance renames a prefs file it cannot read to <name>.bad and writes its defaults (seen with the empty copy).
  it('removes the rejected empty first-start copy and keeps a rejected profile beside the portable one', async () => {
    await fixture(async ({ canonical, system }) => {
      const bridge = new PortablePrefsBridge(canonical, system, async () => false, 'test-machine');
      const first = await bridge.prepare();
      await rename(first.workingFile, `${first.workingFile}.bad`);
      await writeFile(first.workingFile, 'game defaults');
      await first.finish();
      assert.equal(await readFile(canonical, 'utf8'), 'game defaults');
      await assert.rejects(readFile(`${canonical}.bad`), { code: 'ENOENT' });

      await writeFile(canonical, 'unreadable profile');
      const second = await bridge.prepare();
      await rename(second.workingFile, `${second.workingFile}.bad`);
      await writeFile(second.workingFile, 'game defaults again');
      await second.finish();
      assert.equal(await readFile(canonical, 'utf8'), 'game defaults again');
      assert.equal(await readFile(`${canonical}.bad`, 'utf8'), 'unreadable profile');
      assert.deepEqual(await readdir(system), []);
    });
  });

  it('recovers a completed working file after a launcher crash before allowing writes', async () => {
    await fixture(async ({ canonical, system, journal, working }) => {
      await writeFile(canonical, 'before');
      await writeFile(working, 'after');
      await pending(journal, system);
      await new PortablePrefsBridge(canonical, system, async () => false, 'test-machine').recover();
      assert.equal(await readFile(canonical, 'utf8'), 'after');
      await assert.rejects(readFile(journal), { code: 'ENOENT' });
      await updateGamePrefs(canonical, () => 'editable');
    });
  });

  it('does not restore a partially prepared working file', async () => {
    await fixture(async ({ canonical, system, journal, working }) => {
      await writeFile(canonical, 'safe profile');
      await writeFile(working, 'partial bytes');
      await writeFile(`${working}.tfaf-stage`, 'incomplete');
      await pending(journal, system, 'preparing');
      await new PortablePrefsBridge(canonical, system, async () => false, 'test-machine').recover();
      assert.equal(await readFile(canonical, 'utf8'), 'safe profile');
      await assert.rejects(readFile(working), { code: 'ENOENT' });
    });
  });

  it('retries cleanup after a crash between deleting the working file and removing the journal', async () => {
    await fixture(async ({ canonical, system, journal }) => {
      await writeFile(canonical, 'already saved');
      await pending(journal, system, 'saved');
      await new PortablePrefsBridge(canonical, system, async () => false, 'test-machine').recover();
      assert.equal(await readFile(canonical, 'utf8'), 'already saved');
      await assert.rejects(readFile(journal), { code: 'ENOENT' });
    });
  });

  it('waits for a surviving game before recovery or preference edits', async () => {
    await fixture(async ({ canonical, system, journal, working }) => {
      await writeFile(canonical, 'before');
      await writeFile(working, 'still being edited');
      await pending(journal, system);
      let running = true;
      const bridge = new PortablePrefsBridge(canonical, system, async () => running, 'test-machine');
      await assert.rejects(bridge.recover());
      await assert.rejects(updateGamePrefs(canonical, () => 'unsafe'));
      assert.equal(await readFile(canonical, 'utf8'), 'before');
      running = false;
      await bridge.recover();
      assert.equal(await readFile(canonical, 'utf8'), 'still being edited');
    });
  });

  it('keeps recovery files on a failed save and can recover after the destination becomes writable', async () => {
    await fixture(async ({ canonical, system, journal }) => {
      await writeFile(canonical, 'before');
      const bridge = new PortablePrefsBridge(canonical, system, async () => false, 'test-machine');
      const session = await bridge.prepare();
      await writeFile(session.workingFile, 'after');
      await rm(canonical);
      await mkdir(canonical);
      await assert.rejects(session.finish());
      assert.equal(await readFile(session.workingFile, 'utf8'), 'after');
      assert.ok(await readFile(journal));
      await assert.rejects(updateGamePrefs(canonical, () => 'unsafe'));
      await rm(canonical, { recursive: true });
      await bridge.recover();
      assert.equal(await readFile(canonical, 'utf8'), 'after');
    });
  });

  it('sets aside an unreadable journal or one of another computer and keeps the last saved profile', async () => {
    await fixture(async ({ canonical, system, journal, working }) => {
      await writeFile(canonical, 'safe profile');
      await writeFile(working, 'never restored');
      const bridge = new PortablePrefsBridge(canonical, system, async () => false, 'test-machine');
      const staleJournals = async (): Promise<string[]> =>
        (await readdir(path.dirname(canonical))).filter((name) => name.endsWith('.stale'));

      await writeFile(journal, '{"version":1,"phase":');
      assert.match((await bridge.recover()) ?? '', /\.stale/);
      await pending(journal, system, 'ready', '../TFAF.prefs');
      assert.match((await bridge.recover()) ?? '', /\.stale/);
      await pending(journal, path.join(system, 'different-profile'));
      assert.match((await bridge.recover()) ?? '', /different-profile/);
      await pending(journal, system);
      assert.match((await new PortablePrefsBridge(canonical, system, async () => false, 'other-machine').recover()) ?? '', /\.stale/);

      assert.equal(await readFile(canonical, 'utf8'), 'safe profile');
      assert.equal(await readFile(working, 'utf8'), 'never restored');
      await assert.rejects(readFile(journal), { code: 'ENOENT' });
      assert.equal((await staleJournals()).length, 4);
      assert.equal(await bridge.recover(), null);
      await updateGamePrefs(canonical, () => 'editable');
      const session = await bridge.prepare();
      await session.cancel();
      assert.equal(await readFile(canonical, 'utf8'), 'editable');
    });
  });
});

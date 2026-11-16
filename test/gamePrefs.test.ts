import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ensureOwnPrefs, ownPrefsPath, parseActiveMods, replaceActiveMods } from '../src/main/vault/gamePrefs.ts';

const PREFS = `profile = {
    current = 1,
}
active_mods = {
    ['uid-a'] = true,
    ['uid-b'] = false,
    ['uid-c'] = true
}
options = {
    sound = { volume = 80 },
}
`;

describe('Game.prefs active mods', () => {
  it('reads only enabled mods', () => {
    assert.deepEqual([...parseActiveMods(PREFS)], ['uid-a', 'uid-c']);
  });

  it('returns no mods when the block is missing', () => {
    assert.equal(parseActiveMods('profile = {}').size, 0);
  });

  it('replaces the block and keeps the rest of the file untouched', () => {
    const updated = replaceActiveMods(PREFS, ['uid-x', 'uid-y']);
    assert.deepEqual([...parseActiveMods(updated)], ['uid-x', 'uid-y']);
    assert.ok(updated.startsWith('profile = {\n    current = 1,\n}\n'));
    assert.ok(updated.endsWith('options = {\n    sound = { volume = 80 },\n}\n'));
  });

  it('appends the block on a new line when it is missing', () => {
    const updated = replaceActiveMods('profile = {}', ['uid-x']);
    assert.equal(updated, "profile = {}\nactive_mods = {\n    ['uid-x'] = true\n}\n");
  });

  it('never writes uids that would break out of the Lua string', () => {
    const updated = replaceActiveMods('', ["bad'] = true, evil = {", 'good']);
    assert.deepEqual([...parseActiveMods(updated)], ['good']);
    assert.ok(!updated.includes('evil'));
  });
});

describe('TFAF.prefs', () => {
  it('starts as a copy of Game.prefs once and then stays its own', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'tfaf-own-prefs-'));
    try {
      const shared = path.join(folder, 'Game.prefs');
      const own = path.join(folder, 'TFAF.prefs');
      assert.equal(ownPrefsPath(shared), own);
      // Without Game.prefs there is nothing to copy: the game makes TFAF.prefs on its first start.
      assert.equal(await ensureOwnPrefs(shared), own);
      await assert.rejects(readFile(own));

      await writeFile(shared, PREFS);
      const results = await Promise.all([ensureOwnPrefs(shared), ensureOwnPrefs(shared)]);
      assert.deepEqual(results, [own, own]);
      assert.equal(await readFile(own, 'utf8'), PREFS);

      await writeFile(own, 'own = 1\n');
      await writeFile(shared, 'shared = 2\n');
      await ensureOwnPrefs(shared);
      assert.equal(await readFile(own, 'utf8'), 'own = 1\n');
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { JoinPasswordStore, parseJoinPasswords } from '../src/main/joinPasswords.ts';

describe('remembered join passwords', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tfaf-join-passwords-'));
  after(() => rm(directory, { recursive: true, force: true }));

  it('keeps a password by host and drops what is not one', () => {
    assert.deepEqual([...parseJoinPasswords({ Alpha: 'secret', beta: '', gamma: 5, delta: 'x'.repeat(65) })], [['alpha', 'secret']]);
    assert.deepEqual([...parseJoinPasswords(['secret'])], []);
  });

  it('finds the host without case, forgets on request and survives a restart', async () => {
    const file = path.join(directory, 'join-passwords.json');
    const store = await JoinPasswordStore.load(file);
    await store.set('Alpha', 'old');
    await store.set('ALPHA', 'new');
    await store.set('Beta', 'other');
    await store.set('beta', null);
    assert.equal(store.get('alpha'), 'new');
    assert.equal(store.get('beta'), null);
    assert.equal((await JoinPasswordStore.load(file)).get('Alpha'), 'new');
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { alpha: 'new' });
  });
});

import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { toClanInfo } from '../src/main/info/clans.ts';
import { MAX_NOTE_LENGTH, parseNotes, PlayerNotesStore } from '../src/main/playerNotes.ts';

describe('player notes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tfaf-notes-'));
  after(() => rm(directory, { recursive: true, force: true }));

  it('keeps notes by player id and drops what is not one', () => {
    assert.deepEqual([...parseNotes({ '12': ' plays Aeon ', abc: 'x', '-1': 'x', '7': '', '8': 5 })], [[12, 'plays Aeon']]);
    assert.deepEqual([...parseNotes([1, 2])], []);
  });

  it('writes notes, removes empty ones and survives a restart', async () => {
    const file = path.join(directory, 'notes.json');
    const store = await PlayerNotesStore.load(file);
    await store.set(5, 'good teammate');
    assert.deepEqual(await store.set(6, 'x'.repeat(MAX_NOTE_LENGTH + 10)), { 5: 'good teammate', 6: 'x'.repeat(MAX_NOTE_LENGTH) });
    assert.deepEqual(await store.set(6, '   '), { 5: 'good teammate' });
    assert.deepEqual((await PlayerNotesStore.load(file)).list(), { 5: 'good teammate' });
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { 5: 'good teammate' });
  });

  it('keeps a damaged file aside instead of overwriting it', async () => {
    const file = path.join(directory, 'broken.json');
    await writeFile(file, '{ not json');
    const store = await PlayerNotesStore.load(file);
    assert.deepEqual(store.list(), {});
    assert.ok((await readdir(directory)).includes('broken.json.corrupt'));
  });
});

describe('clan info', () => {
  it('takes the website only over https and the leader by login', () => {
    const clan = { id: '1', $type: 'clan', tag: 'TFAF', name: 'The Friends', websiteUrl: 'https://tfaf.example', leader: { id: '2', $type: 'player', login: 'Tergride' } };
    assert.deepEqual(toClanInfo(clan), { tag: 'TFAF', name: 'The Friends', websiteUrl: 'https://tfaf.example', leader: 'Tergride' });
    assert.equal(toClanInfo({ ...clan, websiteUrl: 'http://tfaf.example' })?.websiteUrl, null);
    assert.equal(toClanInfo({ ...clan, websiteUrl: 'javascript:alert(1)' })?.websiteUrl, null);
    assert.equal(toClanInfo({ ...clan, leader: null })?.leader, null);
    assert.equal(toClanInfo({ ...clan, tag: null }), null);
  });
});

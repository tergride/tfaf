import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { GamePresetStore, parseHostGameDraft, parsePresetName, parseStoredPresets } from '../src/main/gamePresets.ts';
import type { HostGameDraft } from '../src/shared/contract.ts';

const DRAFT: HostGameDraft = {
  title: 'Friday 2v2',
  password: 'secret',
  featuredMod: 'faf',
  mapFolderName: 'seton_s_clutch.v0002',
  modUids: ['uid-a', 'uid-b'],
  friendsOnly: true,
  ratingMin: 800,
  ratingMax: null,
  enforceRatingRange: false,
  modIsolation: true,
  lobbyMode: 'faf',
};

describe('host game draft parsing', () => {
  it('accepts an incomplete draft and drops duplicate mods', () => {
    const draft = parseHostGameDraft({ ...DRAFT, title: 'Игра без латиницы', mapFolderName: '', modUids: ['x', 'x'] });
    assert.deepEqual(draft, { ...DRAFT, title: 'Игра без латиницы', mapFolderName: '', modUids: ['x'] });
  });

  it('turns mod isolation off for drafts saved before it was a setting', () => {
    const { modIsolation: _, ...older } = DRAFT;
    assert.deepEqual(parseHostGameDraft(older), { ...DRAFT, modIsolation: false });
  });

  it('rejects wrong types and values over the limits', () => {
    for (const broken of [
      null,
      [],
      { ...DRAFT, title: 'x'.repeat(101) },
      { ...DRAFT, password: 42 },
      { ...DRAFT, featuredMod: 'faf; rm' },
      { ...DRAFT, ratingMin: 10.5 },
      { ...DRAFT, ratingMax: 20_000 },
      { ...DRAFT, modUids: [''] },
      { ...DRAFT, friendsOnly: 'yes' },
      { ...DRAFT, enforceRatingRange: undefined },
      { ...DRAFT, modIsolation: 'on' },
    ]) {
      assert.equal(parseHostGameDraft(broken), null, JSON.stringify(broken));
    }
  });

  it('trims preset names and rejects empty or long ones', () => {
    assert.equal(parsePresetName('  Вечер  '), 'Вечер');
    assert.equal(parsePresetName('   '), null);
    assert.equal(parsePresetName('x'.repeat(61)), null);
  });

  it('keeps the valid presets of a damaged file', () => {
    const stored = parseStoredPresets({
      lastDraft: { broken: true },
      presets: [{ id: 'a', name: 'Good', draft: DRAFT }, { id: 'b', name: '', draft: DRAFT }, 'garbage'],
    });
    assert.deepEqual(stored, { lastDraft: null, presets: [{ id: 'a', name: 'Good', draft: DRAFT }] });
  });
});

describe('game preset store', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tfaf-presets-'));
  after(() => rm(directory, { recursive: true, force: true }));

  it('starts empty and keeps presets and the draft across loads', async () => {
    const filePath = path.join(directory, 'roundtrip.json');
    const store = await GamePresetStore.load(filePath);
    assert.deepEqual(store.get(), { lastDraft: null, presets: [] });

    await store.saveDraft({ ...DRAFT, title: 'draft' });
    const [created] = await store.save('Вечер', DRAFT);
    assert.ok(created);

    const reloaded = await GamePresetStore.load(filePath);
    assert.deepEqual(reloaded.get(), {
      lastDraft: { ...DRAFT, title: 'draft' },
      presets: [{ id: created.id, name: 'Вечер', draft: DRAFT }],
    });
  });

  it('replaces a preset with the same name regardless of case and deletes by id', async () => {
    const store = await GamePresetStore.load(path.join(directory, 'replace.json'));
    const [first] = await store.save('Вечер', DRAFT);
    const replaced = await store.save('ВЕЧЕР', { ...DRAFT, title: 'Updated' });
    assert.equal(replaced.length, 1);
    assert.equal(replaced[0]?.id, first?.id);
    assert.equal(replaced[0]?.draft.title, 'Updated');

    assert.deepEqual(await store.delete(first?.id ?? ''), []);
  });

  it('refuses more presets than the limit', async () => {
    const store = await GamePresetStore.load(path.join(directory, 'limit.json'));
    for (let index = 0; index < 50; index++) {
      await store.save(`Preset ${index}`, DRAFT);
    }
    await assert.rejects(store.save('One more', DRAFT), /не больше 50/);
  });

  it('moves a corrupt file aside instead of overwriting it', async () => {
    const filePath = path.join(directory, 'corrupt.json');
    await writeFile(filePath, '{ not json');
    const store = await GamePresetStore.load(filePath);
    assert.deepEqual(store.get(), { lastDraft: null, presets: [] });
    assert.equal(await readFile(`${filePath}.corrupt`, 'utf8'), '{ not json');
  });

  it('writes drafts saved in a burst one after another', async () => {
    const filePath = path.join(directory, 'burst.json');
    const store = await GamePresetStore.load(filePath);
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.saveDraft({ ...DRAFT, title: `t${index}` })));
    const reloaded = await GamePresetStore.load(filePath);
    assert.equal(reloaded.get().lastDraft?.title, 't19');
  });
});

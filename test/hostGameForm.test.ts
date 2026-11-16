import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createHostGameSchema,
  createPresetNameSchema,
  EMPTY_DRAFT,
  ratingOrderError,
} from '../src/renderer/src/lib/hostGameForm.ts';

const VALID = { ...EMPTY_DRAFT, title: '  Friday 2v2  ', mapFolderName: 'seton_s_clutch.v0002' };
const hostGameSchema = createHostGameSchema();
const presetNameSchema = createPresetNameSchema();

function firstError(input: unknown): string | undefined {
  const result = hostGameSchema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe('create-game form schema', () => {
  it('accepts a complete form and trims the title like the main process', () => {
    const result = hostGameSchema.safeParse(VALID);
    assert.ok(result.success);
    assert.equal(result.data.title, 'Friday 2v2');
  });

  it('explains what the lobby server would reject', () => {
    assert.equal(firstError({ ...VALID, title: '   ' }), 'Введите название игры');
    assert.match(firstError({ ...VALID, title: 'Игра с друзьями' }) ?? '', /латинские/);
    assert.match(firstError({ ...VALID, password: 'пароль' }) ?? '', /латинские/);
    assert.equal(firstError({ ...VALID, mapFolderName: '' }), 'Выберите карту');
    assert.equal(firstError({ ...VALID, ratingMin: 1.5 }), 'Введите целое число');
    assert.equal(firstError({ ...VALID, ratingMax: 20_000 }), 'Не больше 10000');
  });

  it('reports a minimum rating above the maximum', () => {
    assert.equal(ratingOrderError(1500, 1000), 'Минимальный рейтинг больше максимального');
    assert.equal(ratingOrderError(1000, 1000), null);
    assert.equal(ratingOrderError(null, 1000), null);
  });

  it('limits preset names', () => {
    assert.equal(presetNameSchema.safeParse('  Вечер  ').data, 'Вечер');
    assert.equal(presetNameSchema.safeParse(' ').success, false);
    assert.equal(presetNameSchema.safeParse('x'.repeat(61)).success, false);
  });
});

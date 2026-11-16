import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSteamLibraries } from '../src/main/gameLocator.ts';

describe('parseSteamLibraries', () => {
  it('reads library paths and unescapes backslashes', () => {
    const vdf = [
      '"libraryfolders"',
      '{',
      '\t"0"',
      '\t{',
      '\t\t"path"\t\t"G:\\\\Steam"',
      '\t\t"label"\t\t""',
      '\t}',
      '\t"1"',
      '\t{',
      '\t\t"path"\t\t"D:\\\\SteamLibrary"',
      '\t}',
      '}',
    ].join('\n');
    assert.deepEqual(parseSteamLibraries(vdf), ['G:\\Steam', 'D:\\SteamLibrary']);
  });
});

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';
import { developmentExecutable } from '../src/main/stoneMap/stoneMapBuild.ts';
import { parseHandshake, readServerSentEvents } from '../src/main/stoneMap/stoneMapProcess.ts';
import { previewQuery } from '../src/main/stoneMap/stoneMapService.ts';

// The validation pulls in the settings, which need app.getPath; nothing here touches a profile.
const electronSource = `export const app = { getPath: () => ${JSON.stringify(tmpdir())}, getVersion: () => '0.0.0' };`;
const electronUrl = `data:text/javascript,${encodeURIComponent(electronSource)}`;
// eslint-disable-next-line @typescript-eslint/no-deprecated -- the tests' Electron stand-in loads through module.register
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    return specifier === 'electron' ? { url: ${JSON.stringify(electronUrl)}, shortCircuit: true } : next(specifier, context);
  }
`)}`, import.meta.url);

const { parsePresentation, parsePreviewOptions, parseStoneMapBody, parseStoneMapJobId, parseStoneMapJobLimit } = await import(
  '../src/main/stoneMap/stoneMapValidation.ts'
);
const { InvalidInputError } = await import('../src/main/validation.ts');

const TOKEN = 'a'.repeat(43);

function ready(fields: Record<string, unknown>): string {
  return JSON.stringify({ type: 'ready', apiVersion: '1.0', url: 'http://127.0.0.1:50878', token: TOKEN, pid: 42, ...fields });
}

async function* chunks(...parts: string[]): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  for (const part of parts) {
    yield encoder.encode(part);
  }
}

async function events(...parts: string[]): Promise<{ id: string; event: string; data: string }[]> {
  const all = [];
  for await (const event of readServerSentEvents(chunks(...parts))) {
    all.push(event);
  }
  return all;
}

describe('StoneMap API handshake', () => {
  it('takes the local address, the token and the process id', () => {
    assert.deepEqual(parseHandshake(ready({})), { origin: 'http://127.0.0.1:50878', token: TOKEN, pid: 42 });
  });

  it('refuses an address other than 127.0.0.1', () => {
    for (const url of ['http://localhost:5000', 'http://192.168.1.2:5000', 'https://127.0.0.1:5000', 'http://127.0.0.1', 'http://127.0.0.1:5000/api']) {
      assert.throws(() => parseHandshake(ready({ url })), url);
    }
  });

  it('refuses another API version, a missing token and lines that are not the handshake', () => {
    assert.throws(() => parseHandshake(ready({ apiVersion: '2.0' })));
    assert.throws(() => parseHandshake(ready({ token: '' })));
    assert.throws(() => parseHandshake(ready({ type: 'log' })));
    assert.throws(() => parseHandshake('Now listening on http://127.0.0.1:5000'));
  });
});

describe('StoneMap job events', () => {
  it('joins events split across chunks and skips comments', async () => {
    assert.deepEqual(await events(': keep-alive\n\nid: 1\nevent: st', 'ate\ndata: {"a":1}\n\nid: 2\r\nevent: progress\r\ndata: {"b":2}\r\n\r\n'), [
      { id: '1', event: 'state', data: '{"a":1}' },
      { id: '2', event: 'progress', data: '{"b":2}' },
    ]);
  });

  it('joins data lines of one event and leaves out an unfinished one', async () => {
    assert.deepEqual(await events('data: {"a":\ndata: 1}\n\ndata: {"partial"'), [{ id: '', event: 'message', data: '{"a":\n1}' }]);
  });
});

describe('StoneMap requests from the renderer', () => {
  it('takes plain JSON objects, with fields left unset', () => {
    const request = { settings: { seed: '5', mapSize: 512, topology: { kind: 'ISLAND', waterRatio: 0.6 }, style: undefined }, preview: { kinds: [] } };
    assert.deepEqual(parseStoneMapBody(request), request);
  });

  it('refuses what is not plain JSON', () => {
    for (const value of [null, [], 'text', { when: new Date() }, { bytes: new Uint8Array(2) }, { value: Number.NaN }, { value: () => 1 }]) {
      assert.throws(() => parseStoneMapBody(value), InvalidInputError);
    }
  });

  it('refuses requests over 1 MiB and deeply nested ones', () => {
    assert.throws(() => parseStoneMapBody({ text: 'x'.repeat(1024 * 1024) }), InvalidInputError);
    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth < 40; depth++) {
      nested = { nested };
    }
    assert.throws(() => parseStoneMapBody(nested), InvalidInputError);
  });

  it('takes job ids in the API form and limits of 1 to 256', () => {
    assert.equal(parseStoneMapJobId('42219CEC-92C9-4ABD-9A0E-E60D933B4D6C'), '42219cec-92c9-4abd-9a0e-e60d933b4d6c');
    assert.throws(() => parseStoneMapJobId('../shutdown'), InvalidInputError);
    assert.throws(() => parseStoneMapJobId('42219cec92c94abd9a0ee60d933b4d6c'), InvalidInputError);
    assert.equal(parseStoneMapJobLimit(256), 256);
    assert.throws(() => parseStoneMapJobLimit(0), InvalidInputError);
    assert.throws(() => parseStoneMapJobLimit(1.5), InvalidInputError);
  });

  it('takes known preview options only', () => {
    const options = { kind: 'textures', quality: 'high', size: 2048, markers: false, waterSurface: true } as const;
    assert.deepEqual(parsePreviewOptions(options), options);
    assert.equal(previewQuery(options), 'kind=textures&quality=high&size=2048&markers=false&waterSurface=true');
    for (const bad of [{ kind: 'scmap' }, { size: 4096 }, { size: 100 }, { markers: 'yes' }, { path: '/etc' }]) {
      assert.throws(() => parsePreviewOptions(bad), InvalidInputError, JSON.stringify(bad));
    }
  });

  it('takes a name of up to 80 characters and a description of up to 2000', () => {
    assert.deepEqual(parsePresentation({ name: 'Северные острова', description: null }), { name: 'Северные острова', description: null });
    assert.deepEqual(parsePresentation({}), {});
    assert.throws(() => parsePresentation({ name: 'x'.repeat(81) }), InvalidInputError);
    assert.throws(() => parsePresentation({ description: 'x'.repeat(2001) }), InvalidInputError);
    assert.throws(() => parsePresentation({ name: 'a', mapName: 'b' }), InvalidInputError);
  });
});

describe('StoneMap development build', () => {
  const exe = 'D:\\StoneMap\\bin\\StoneMap.Api.exe';

  it('is taken only by an unpackaged launcher and only as an absolute path to the API', () => {
    assert.equal(developmentExecutable(false, { TFAF_STONEMAP_API: exe }), exe);
    assert.equal(developmentExecutable(true, { TFAF_STONEMAP_API: exe }), null);
    assert.equal(developmentExecutable(false, {}), null);
    assert.equal(developmentExecutable(false, { TFAF_STONEMAP_API: 'StoneMap.Api.exe' }), null);
    assert.equal(developmentExecutable(false, { TFAF_STONEMAP_API: 'D:\\tools\\other.exe' }), null);
  });
});

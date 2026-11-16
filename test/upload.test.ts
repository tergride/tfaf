import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { CancelledError } from '../src/main/errors.ts';
import { TimeoutError } from '../src/main/net/http.ts';
import { fileBody, multipartBody, sendUpload, type UploadBody } from '../src/main/net/upload.ts';

const FILE_CONTENT = Buffer.from(Array.from({ length: 256 * 1024 }, (_, index) => index % 253));

interface Received {
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

let server: http.Server;
let baseUrl = '';
let directory = '';
let file = '';
const received: Received[] = [];

async function collect(body: UploadBody): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body.open()) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'tfaf-upload-'));
  file = path.join(directory, 'map.zip');
  await writeFile(file, FILE_CONTENT);
  server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({ headers: request.headers, body: Buffer.concat(chunks) });
      // `/silent` takes the whole body and never answers.
      if (request.url !== '/silent') {
        response.writeHead(201, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});

describe('multipart body', () => {
  it('streams fields and files with the length announced up front', async () => {
    const body = await multipartBody(
      [
        { name: 'metadata', value: '{"isRanked":true}', contentType: 'application/json' },
        { name: 'file', file, fileName: 'my "map".zip', contentType: 'application/zip' },
      ],
      'XYZ',
    );
    const expected = Buffer.concat([
      Buffer.from(
        '--XYZ\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n{"isRanked":true}\r\n' +
          '--XYZ\r\nContent-Disposition: form-data; name="file"; filename="my %22map%22.zip"\r\nContent-Type: application/zip\r\n\r\n',
      ),
      FILE_CONTENT,
      Buffer.from('\r\n--XYZ--\r\n'),
    ]);
    assert.equal(body.contentType, 'multipart/form-data; boundary=XYZ');
    assert.equal(body.length, expected.length);
    assert.deepEqual(await collect(body), expected);
    // Every attempt reads the file again.
    assert.deepEqual(await collect(body), expected);
  });
});

describe('sendUpload', () => {
  it('sends the length instead of chunks and reports progress up to the whole body', async () => {
    received.length = 0;
    const progress: number[] = [];
    const body = await fileBody(file, 'application/zip');
    const response = await sendUpload(new URL(`${baseUrl}/put`), 'PUT', { 'User-Agent': 'test' }, body, {
      onProgress: (sent, total) => {
        assert.equal(total, FILE_CONTENT.length);
        progress.push(sent);
      },
    });
    assert.equal(response.status, 201);
    assert.equal(response.text, '{"ok":true}');
    const [request] = received;
    assert.equal(request?.headers['content-length'], String(FILE_CONTENT.length));
    assert.equal(request?.headers['transfer-encoding'], undefined);
    assert.equal(request?.headers['content-type'], 'application/zip');
    assert.deepEqual(request?.body, FILE_CONTENT);
    assert.equal(progress.at(-1), FILE_CONTENT.length);
    assert.ok(progress.every((sent, index) => index === 0 || sent > progress[index - 1]!));
  });

  it('fails with CancelledError when the user cancels', async () => {
    const controller = new AbortController();
    const body = await fileBody(file, 'application/zip');
    await assert.rejects(
      sendUpload(new URL(`${baseUrl}/put`), 'PUT', {}, body, { signal: controller.signal, onProgress: () => controller.abort() }),
      CancelledError,
    );
  });

  it('gives up on a server that never answers', async () => {
    const body = await fileBody(file, 'application/zip');
    await assert.rejects(
      sendUpload(new URL(`${baseUrl}/silent`), 'POST', {}, body, {}, { stallTimeoutMs: 5_000, responseTimeoutMs: 100 }),
      TimeoutError,
    );
  });
});

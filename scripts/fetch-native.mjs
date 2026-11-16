// Downloads the native helpers the launcher runs into resources/native.
// Versions and checksums are pinned to the ones the official client v2026.7.1 ships (gradle.properties in
// downlords-faf-client).

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const targetDirectory = path.join(import.meta.dirname, '..', 'resources', 'native');

const BINARIES = [
  {
    platform: 'win32',
    file: 'faf-uid.exe',
    url: 'https://github.com/FAForever/uid/releases/download/v4.0.7/faf-uid.exe',
    sha256: 'b9ceaa71dad26c0eb8472c63d4dd27ab7328ffd941407c78d7bfddd90933c337',
  },
];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function existingMatches(file, expectedHash) {
  try {
    return sha256(await readFile(file)) === expectedHash;
  } catch {
    return false;
  }
}

await mkdir(targetDirectory, { recursive: true });
const binaries = BINARIES.filter((binary) => binary.platform === process.platform);
if (binaries.length === 0) {
  console.log(`No native helpers are pinned for ${process.platform} yet.`);
}

for (const binary of binaries) {
  const destination = path.join(targetDirectory, binary.file);
  if (await existingMatches(destination, binary.sha256)) {
    console.log(`${binary.file}: up to date`);
    continue;
  }
  console.log(`${binary.file}: downloading ${binary.url}`);
  const response = await fetch(binary.url);
  if (!response.ok) {
    throw new Error(`${binary.file}: download failed with HTTP ${response.status}`);
  }
  const content = Buffer.from(await response.arrayBuffer());
  const actualHash = sha256(content);
  if (actualHash !== binary.sha256) {
    throw new Error(`${binary.file}: checksum mismatch (expected ${binary.sha256}, got ${actualHash})`);
  }
  await writeFile(`${destination}.tmp`, content, { mode: 0o755 });
  await rename(`${destination}.tmp`, destination);
  console.log(`${binary.file}: ok`);
}

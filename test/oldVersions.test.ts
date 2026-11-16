import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { RuntimeComponents } from '../src/main/game/runtimeComponents.ts';
import { removeOldVersions } from '../src/main/oldVersions.ts';
import type { SettingsStore } from '../src/main/settings.ts';
import type { TaskReporter } from '../src/main/tasks.ts';
import { MapGenerator } from '../src/main/vault/mapGenerator.ts';

describe('old versions of downloaded components', () => {
  let dataPath: string;
  let runtimeDirectory: string;
  let runtime: RuntimeComponents;
  let generator: MapGenerator;

  before(async () => {
    dataPath = await mkdtemp(path.join(os.tmpdir(), 'tfaf-old-versions-'));
    runtimeDirectory = path.join(dataPath, 'runtime');
    const settings = { get: () => ({ dataPath }) } as unknown as SettingsStore;
    const tasks = {} as TaskReporter;
    runtime = new RuntimeComponents(settings, tasks, 'test');
    generator = new MapGenerator(runtime, settings, tasks, 'test');

    await mkdir(path.join(runtimeDirectory, 'jdk-25.0.4.1+1-jre', 'bin'), { recursive: true });
    await writeFile(path.join(runtimeDirectory, 'jdk-25.0.4.1+1-jre', 'bin', 'java.exe'), Buffer.alloc(400));
    await mkdir(path.join(runtimeDirectory, 'jdk-21.0.12.1+1-jre', 'bin'), { recursive: true });
    await writeFile(path.join(runtimeDirectory, 'jdk-21.0.12.1+1-jre', 'bin', 'java.exe'), Buffer.alloc(300));
    await writeFile(path.join(runtimeDirectory, 'jdk-21.0.12.1+1-jre', 'release'), Buffer.alloc(20));
    await writeFile(path.join(runtimeDirectory, 'faf-ice-adapter-3.3.14.jar'), Buffer.alloc(70));
    await writeFile(path.join(runtimeDirectory, 'faf-ice-adapter-3.3.9.jar'), Buffer.alloc(50));
    await writeFile(path.join(runtimeDirectory, 'ice-adapter-logback.xml'), '<configuration/>');
    const generators = path.join(runtimeDirectory, 'map_generator');
    await mkdir(generators);
    for (const version of ['1.9.4', '1.22.2', '1.10.0']) {
      await writeFile(path.join(generators, `NeroxisGen_${version}.jar`), Buffer.alloc(10));
    }
    await writeFile(path.join(generators, 'NeroxisGen_1.23.0.jar.tmp'), 'downloading');
  });

  after(() => rm(dataPath, { recursive: true, force: true }));

  it('lists the Java runtimes and adapters other than the current ones', async () => {
    const found = (await runtime.oldVersions()).map(({ title, bytes }) => ({ title, bytes }));
    assert.deepEqual(
      found.sort((a, b) => a.title.localeCompare(b.title)),
      [
        { title: 'Java 21.0.12.1+1', bytes: 320 },
        { title: 'Java ICE-адаптер 3.3.9', bytes: 50 },
      ],
    );
  });

  it('keeps the newest generator by version number', async () => {
    assert.deepEqual(
      (await generator.oldVersions()).map((version) => version.title),
      ['Генератор карт 1.9.4', 'Генератор карт 1.10.0'],
    );
  });

  it('removes the old versions and counts the space freed', async () => {
    const result = await removeOldVersions([...(await runtime.oldVersions()), ...(await generator.oldVersions())]);
    assert.deepEqual(result, { freedBytes: 320 + 50 + 10 + 10, remaining: [] });
    assert.deepEqual((await readdir(runtimeDirectory)).sort(), [
      'faf-ice-adapter-3.3.14.jar',
      'ice-adapter-logback.xml',
      'jdk-25.0.4.1+1-jre',
      'map_generator',
    ]);
    assert.deepEqual((await readdir(path.join(runtimeDirectory, 'map_generator'))).sort(), [
      'NeroxisGen_1.22.2.jar',
      'NeroxisGen_1.23.0.jar.tmp',
    ]);
  });
});

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { t } from '../i18n.ts';
import { oldVersionFile, type OldVersionFile } from '../oldVersions.ts';
import type { SettingsStore } from '../settings.ts';
import type { TaskReporter } from '../tasks.ts';
import { downloadToTempFile, progressFraction } from '../vault/download.ts';
import { pathExists } from '../vault/fsUtil.ts';
import { installArchive } from '../vault/installer.ts';

// Java components: the official Java ICE adapter and the Neroxis map generator. They are downloaded on first use
// instead of being shipped with the launcher. The official client v2026.7.1 runs both on its own Java 25; the
// generator needs it (class files of Java 25), the adapter 3.3.14 runs on Java 21 and later.
const JAVA_RUNTIME = {
  url: 'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.4.1%2B1/OpenJDK25U-jre_x64_windows_hotspot_25.0.4.1_1.zip',
  sha256: '4c95451cea98556def2c54f7782933f52a26d4a36bd85e1d59f0364464828b07',
  directory: 'jdk-25.0.4.1+1-jre',
};

// Folders of Temurin JRE archives. Runtimes of earlier launcher versions are removed once the current one is in place.
const JAVA_RUNTIME_DIRECTORY = /^jdk-(.+)-jre$/;

const ICE_ADAPTER = {
  url: 'https://github.com/FAForever/java-ice-adapter/releases/download/3.3.14/faf-ice-adapter-3.3.14-nojfx.jar',
  sha256: '5d1348f57d29e51c92e5a80380e4cf0dec85f867bdc6f58d8c4e5b5fc01d8281',
  file: 'faf-ice-adapter-3.3.14.jar',
};
const ICE_ADAPTER_FILE = /^faf-ice-adapter-(.+)\.jar$/;

// The adapter's bundled logback.xml includes a debug-window appender that loads JavaFX on the first log line, even in
// the "-nojfx" build. The official client puts JavaFX on the classpath; we replace the logging config instead.
const LOGBACK_CONFIG = `<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
    <encoder>
      <pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{5} - %msg%n</pattern>
    </encoder>
  </appender>
  <appender name="FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
    <file>\${LOG_DIR}/ice-adapter.log</file>
    <rollingPolicy class="ch.qos.logback.core.rolling.TimeBasedRollingPolicy">
      <fileNamePattern>\${LOG_DIR}/ice-adapter.%d{yyyy-MM-dd}.log</fileNamePattern>
      <maxHistory>5</maxHistory>
      <cleanHistoryOnStart>true</cleanHistoryOnStart>
    </rollingPolicy>
    <encoder>
      <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} %-5level %m (%logger{36}:%L)%n</pattern>
    </encoder>
  </appender>
  <root level="DEBUG">
    <appender-ref ref="STDOUT"/>
    <appender-ref ref="FILE"/>
  </root>
</configuration>
`;

export interface JavaIceAdapterRuntime {
  javaPath: string;
  jarPath: string;
  logbackConfigPath: string;
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

function isOldJavaRuntime(name: string): boolean {
  return JAVA_RUNTIME_DIRECTORY.test(name) && name !== JAVA_RUNTIME.directory;
}

export class RuntimeComponents {
  private readonly settings: SettingsStore;
  private readonly tasks: TaskReporter;
  private readonly userAgent: string;
  private pending: Promise<JavaIceAdapterRuntime> | null = null;
  private pendingJava: Promise<string> | null = null;

  constructor(settings: SettingsStore, tasks: TaskReporter, userAgent: string) {
    this.settings = settings;
    this.tasks = tasks;
    this.userAgent = userAgent;
  }

  ensureJavaIceAdapter(): Promise<JavaIceAdapterRuntime> {
    this.pending ??= this.installJavaIceAdapter().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /** Path of `java.exe`, downloading the runtime first if needed. */
  ensureJava(): Promise<string> {
    this.pendingJava ??= this.installJava().finally(() => {
      this.pendingJava = null;
    });
    return this.pendingJava;
  }

  get runtimeDirectory(): string {
    return path.join(this.settings.get().dataPath, 'runtime');
  }

  /** Java runtimes and Java ICE adapters that earlier launcher versions downloaded. */
  async oldVersions(): Promise<OldVersionFile[]> {
    const directory = this.runtimeDirectory;
    const old: OldVersionFile[] = [];
    for (const name of await readdir(directory).catch(() => [])) {
      const java = JAVA_RUNTIME_DIRECTORY.exec(name);
      const adapter = ICE_ADAPTER_FILE.exec(name);
      if (java && isOldJavaRuntime(name)) {
        old.push(await oldVersionFile(`Java ${java[1] ?? ''}`, path.join(directory, name)));
      } else if (adapter && name !== ICE_ADAPTER.file) {
        old.push(await oldVersionFile(t('main.ice.oldAdapter', { version: adapter[1] ?? '' }), path.join(directory, name)));
      }
    }
    return old;
  }

  private async installJava(): Promise<string> {
    if (process.platform !== 'win32') {
      throw new Error(t('main.ice.javaWindowsOnly'));
    }
    const runtimeDirectory = this.runtimeDirectory;
    await mkdir(runtimeDirectory, { recursive: true });
    const javaPath = path.join(runtimeDirectory, JAVA_RUNTIME.directory, 'bin', 'java.exe');
    if (!(await pathExists(javaPath))) {
      await this.tasks.run(
        t('main.ice.downloadJava'),
        async (task) => {
          const download = await downloadToTempFile(
            JAVA_RUNTIME.url,
            this.userAgent,
            (received, total) => {
              const fraction = progressFraction(received, total);
              task.progress(fraction === null ? null : fraction * 0.9);
            },
            { checksum: { algorithm: 'sha256', digest: JAVA_RUNTIME.sha256 }, signal: task.signal },
          );
          try {
            task.signal.throwIfAborted();
            await installArchive(download.path, runtimeDirectory, (fraction) => task.progress(0.9 + fraction * 0.1));
          } finally {
            await download.cleanup();
          }
        },
        { cancellable: true },
      );
      if (!(await pathExists(javaPath))) {
        throw new Error(t('main.ice.javaArchiveLayout'));
      }
      for (const directory of (await readdir(runtimeDirectory)).filter(isOldJavaRuntime)) {
        await rm(path.join(runtimeDirectory, directory), { recursive: true, force: true }).catch((error: unknown) =>
          console.warn(`Previous Java runtime ${directory} could not be removed`, error),
        );
      }
    }
    return javaPath;
  }

  private async installJavaIceAdapter(): Promise<JavaIceAdapterRuntime> {
    const javaPath = await this.ensureJava();
    const runtimeDirectory = this.runtimeDirectory;
    const jarPath = path.join(runtimeDirectory, ICE_ADAPTER.file);
    if (!(await pathExists(jarPath)) || (await sha256File(jarPath)) !== ICE_ADAPTER.sha256) {
      await this.tasks.run(
        t('main.ice.downloadAdapter'),
        async (task) => {
          const download = await downloadToTempFile(
            ICE_ADAPTER.url,
            this.userAgent,
            (received, total) => task.progress(progressFraction(received, total)),
            { checksum: { algorithm: 'sha256', digest: ICE_ADAPTER.sha256 }, signal: task.signal },
          );
          try {
            await copyFile(download.path, `${jarPath}.tmp`);
            await rename(`${jarPath}.tmp`, jarPath);
          } finally {
            await download.cleanup();
          }
        },
        { cancellable: true },
      );
    }
    const logbackConfigPath = path.join(runtimeDirectory, 'ice-adapter-logback.xml');
    await writeFile(logbackConfigPath, LOGBACK_CONFIG, 'utf8');
    return { javaPath, jarPath, logbackConfigPath };
  }
}

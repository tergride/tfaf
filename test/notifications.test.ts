import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { flashWindowScript } from '../src/main/game/flashWindow.ts';
import { analyzeGameLog, readLogTail } from '../src/main/game/logAnalysis.ts';
import { NotificationCenter } from '../src/main/notifications.ts';
import { replayFileArgument } from '../src/main/openFiles.ts';
import { parseBadgeImage, taskbarProgress, withBadge } from '../src/main/taskbar.ts';
import type { AppNotification, GameSessionState, LaunchStage, TaskProgress } from '../src/shared/contract.ts';

function center(): { center: NotificationCenter; changes: AppNotification[][]; added: AppNotification[] } {
  const changes: AppNotification[][] = [];
  const added: AppNotification[] = [];
  return {
    center: new NotificationCenter({ onChanged: (items) => changes.push(items), onAdded: (item) => added.push(item) }),
    changes,
    added,
  };
}

describe('notification center', () => {
  it('keeps the newest hundred, newest first, and counts the unread', () => {
    const { center: notifications } = center();
    for (let index = 0; index < 105; index++) {
      notifications.add({ severity: 'info', title: `#${index}` });
    }
    const list = notifications.list();
    assert.equal(list.length, 100);
    assert.equal(list[0]?.title, '#104');
    assert.equal(list.at(-1)?.title, '#5');
    assert.equal(notifications.unreadCount(), 100);
    notifications.markAllRead();
    assert.equal(notifications.unreadCount(), 0);
  });

  it('shows transient notifications as toasts only', async () => {
    const { center: notifications, changes, added } = center();
    let clicked = 0;
    const toast = notifications.add({ severity: 'info', title: 'Friend online', transient: true, onClick: () => { clicked++; } });
    assert.deepEqual(notifications.list(), []);
    assert.deepEqual(changes, []);
    assert.equal(added[0]?.transient, true);
    assert.equal(added[0]?.clickable, true);
    await notifications.act(toast.id, null);
    assert.equal(clicked, 1);
  });

  it('runs actions: the notification goes away unless the action keeps it', async () => {
    const { center: notifications } = center();
    const calls: string[] = [];
    const invite = notifications.add({
      severity: 'info',
      title: 'Invite',
      actions: [
        { label: 'Accept', run: () => void calls.push('accept') },
        { label: 'Open log', run: () => void calls.push('log'), keep: true },
      ],
    });
    const [accept, openLog] = invite.actions;
    await notifications.act(invite.id, openLog!.id);
    assert.deepEqual(notifications.list().map((item) => [item.id, item.read]), [[invite.id, true]]);
    await notifications.act(invite.id, accept!.id);
    assert.deepEqual(calls, ['log', 'accept']);
    assert.deepEqual(notifications.list(), []);
    await notifications.act(invite.id, accept!.id);
    assert.deepEqual(calls, ['log', 'accept'], 'a dismissed notification runs nothing');
  });

  it('keeps a notification whose action failed', async () => {
    const { center: notifications } = center();
    const item = notifications.add({ severity: 'info', title: 'Invite', actions: [{ label: 'Accept', run: () => Promise.reject(new Error('offline')) }] });
    await assert.rejects(notifications.act(item.id, item.actions[0]!.id), /offline/);
    assert.equal(notifications.list().length, 1);
  });
});

describe('game log analysis', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tfaf-log-'));
  after(() => rm(directory, { recursive: true, force: true }));

  it('finds a minimized game and XACT sound errors, like the official client', () => {
    assert.deepEqual(analyzeGameLog('info: Minimized true\nwarning: SND: XACT: XACT3DApply failed'), ['minimized', 'sound']);
    assert.deepEqual(analyzeGameLog('warning: SND: device lost'), []);
    assert.deepEqual(analyzeGameLog(''), []);
  });

  it('reads only the end of a long log and nothing of a missing one', async () => {
    const file = path.join(directory, 'game.log');
    await writeFile(file, `${'x'.repeat(1000)}info: Minimized true`);
    assert.equal(await readLogTail(file, 20), 'info: Minimized true');
    assert.equal(await readLogTail(path.join(directory, 'missing.log')), '');
  });
});

describe('taskbar', () => {
  const task = (id: string, progress: number | null): TaskProgress => ({ id, title: id, progress, state: 'running', cancellable: false });
  const stage = (state: LaunchStage['state'], progress: number | null = null): LaunchStage => ({
    id: 'files',
    title: 'Files',
    state,
    progress,
    detail: null,
  });
  const game = (phase: GameSessionState['phase'], stages: LaunchStage[]): GameSessionState => ({
    phase,
    kind: 'online',
    gameId: null,
    title: null,
    message: null,
    error: null,
    peers: [],
    files: null,
    featureIssues: [],
    stages,
    cancellable: true,
    current: null,
    tfafLobby: null,
  });

  it('shows a game start by its stages, then the downloads together', () => {
    assert.deepEqual(taskbarProgress([task('a', 0.5)], game('preparing', [stage('done'), stage('running', 0.5), stage('pending')])), {
      mode: 'normal',
      fraction: 0.5,
    });
    assert.deepEqual(taskbarProgress([task('a', 0.2), task('b', 0.6)], null), { mode: 'normal', fraction: 0.4 });
    assert.deepEqual(taskbarProgress([task('a', 0.2), task('b', null)], game('running', [])), { mode: 'indeterminate', fraction: 0 });
    assert.deepEqual(taskbarProgress([], game('idle', [])), { mode: 'none', fraction: 0 });
  });

  function png(width: number, height: number): string {
    const header = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
    header.writeUInt32BE(13, 8);
    header.write('IHDR', 12, 'latin1');
    header.writeUInt32BE(width, 16);
    header.writeUInt32BE(height, 20);
    return `data:image/png;base64,${header.toString('base64')}`;
  }

  it('accepts small PNG badges only', () => {
    assert.equal(parseBadgeImage(png(32, 32)), png(32, 32));
    assert.equal(parseBadgeImage(png(65, 32)), null);
    assert.equal(parseBadgeImage(png(0, 32)), null);
    assert.equal(parseBadgeImage(png(32, 32).replace('image/png', 'image/svg+xml')), null);
    assert.equal(parseBadgeImage('data:image/png;base64,not base64!'), null);
    assert.equal(parseBadgeImage(`data:image/png;base64,${Buffer.from('GIF89a and more bytes here...').toString('base64')}`), null);
    assert.equal(parseBadgeImage(42), null);
  });

  it('draws the badge over the bottom right corner of the tray icon', () => {
    // 3×3 opaque blue icon (BGRA), 2×2 badge: opaque red, half-transparent red (premultiplied), transparent, opaque red.
    const icon = { width: 3, height: 3, data: Buffer.from(Array.from({ length: 9 }, () => [255, 0, 0, 255]).flat()) };
    const badge = { width: 2, height: 2, data: Buffer.from([0, 0, 255, 255, 0, 0, 128, 128, 0, 0, 0, 0, 0, 0, 255, 255]) };
    const pixel = (data: Buffer, x: number, y: number): number[] => [...data.subarray((y * 3 + x) * 4, (y * 3 + x) * 4 + 4)];
    const result = withBadge(icon, badge);
    assert.deepEqual(pixel(result, 0, 0), [255, 0, 0, 255]);
    assert.deepEqual(pixel(result, 1, 1), [0, 0, 255, 255]);
    assert.deepEqual(pixel(result, 2, 1), [127, 0, 128, 255]);
    assert.deepEqual(pixel(result, 1, 2), [255, 0, 0, 255]);
    assert.deepEqual(pixel(result, 2, 2), [0, 0, 255, 255]);
    assert.deepEqual(pixel(icon.data, 1, 1), [255, 0, 0, 255], 'the icon itself stays as it was');
  });

  it('puts only a whole process id into the flashing script', () => {
    assert.match(flashWindowScript(4242), /Get-Process -Id 4242\)/);
    assert.throws(() => flashWindowScript(1.5));
    assert.throws(() => flashWindowScript(-1));
    assert.throws(() => flashWindowScript(Number.NaN));
  });
});

describe('replay files opened from Explorer', () => {
  it('takes the replay path from the command line, whatever Chromium adds', () => {
    assert.equal(replayFileArgument(['C:\\Games\\1234.fafreplay']), 'C:\\Games\\1234.fafreplay');
    assert.equal(
      replayFileArgument(['--allow-file-access-from-files', '--original-process-start-time=1', 'D:\\Replays\\Game.SCFAReplay']),
      'D:\\Replays\\Game.SCFAReplay',
    );
    assert.equal(replayFileArgument(['.', '--inspect']), null);
    assert.equal(replayFileArgument(['relative.fafreplay']), null);
    assert.equal(replayFileArgument(['C:\\notes.txt']), null);
  });
});

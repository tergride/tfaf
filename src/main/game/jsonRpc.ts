// JSON-RPC 2.0 over TCP with one JSON object per line, the transport of the FAF ICE adapter (jjsonrpc).

import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { asObject, asString } from '../api/jsonApi.ts';
import { t } from '../i18n.ts';
import { LineDecoder } from '../lineDecoder.ts';

export type RpcMessage =
  | { kind: 'call'; method: string; params: unknown[]; id: string | number | null }
  | { kind: 'result'; id: string | number; result: unknown }
  | { kind: 'error'; id: string | number; message: string }
  | { kind: 'invalid' };

export function parseRpcMessage(line: string): RpcMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: 'invalid' };
  }
  const message = asObject(parsed);
  if (!message) {
    return { kind: 'invalid' };
  }
  const id = typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null;
  const method = asString(message.method);
  if (method) {
    const params = Array.isArray(message.params) ? message.params : message.params === undefined ? [] : [message.params];
    return { kind: 'call', method, params, id };
  }
  if (id === null) {
    return { kind: 'invalid' };
  }
  if ('error' in message && message.error !== null && message.error !== undefined) {
    return { kind: 'error', id, message: asString(asObject(message.error)?.message) ?? 'RPC error' };
  }
  return { kind: 'result', id, result: message.result };
}

export interface JsonRpcHandlers {
  /** A call from the remote side; requests carrying an id are answered automatically with `null`. */
  onCall(method: string, params: unknown[]): void;
  onClose(): void;
}

interface PendingCall {
  resolve(result: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

const CALL_TIMEOUT_MS = 10_000;

export class JsonRpcClient {
  private readonly socket: net.Socket;
  private readonly handlers: JsonRpcHandlers;
  private readonly lines = new LineDecoder();
  private readonly pending = new Map<number, PendingCall>();
  private nextId = 1;
  private closed = false;

  private constructor(socket: net.Socket, handlers: JsonRpcHandlers) {
    this.socket = socket;
    this.handlers = handlers;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => this.receive(chunk));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }

  /** Connects to a local JSON-RPC server, retrying while the process is still starting up. */
  static async connect(port: number, handlers: JsonRpcHandlers, attempts = 50, retryDelayMs = 250): Promise<JsonRpcClient> {
    for (let attempt = 1; ; attempt++) {
      try {
        const socket = await new Promise<net.Socket>((resolve, reject) => {
          const candidate = net.connect({ host: '127.0.0.1', port }, () => {
            candidate.off('error', reject);
            resolve(candidate);
          });
          candidate.once('error', reject);
        });
        return new JsonRpcClient(socket, handlers);
      } catch (error) {
        if (attempt >= attempts) {
          throw error;
        }
        await delay(retryDelayMs);
      }
    }
  }

  call(method: string, params: unknown[]): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error(t('main.ice.connectionClosed')));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(t('main.ice.callTimeout', { method })));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
      this.write({ jsonrpc: '2.0', method, params, id });
    });
  }

  /** Fire-and-forget call; failures are only logged. */
  send(method: string, params: unknown[]): void {
    this.call(method, params).catch((error: unknown) =>
      console.warn(`ICE adapter call ${method} failed: ${error instanceof Error ? error.message : String(error)}`),
    );
  }

  close(): void {
    this.socket.end();
    this.finish();
  }

  private write(message: object): void {
    if (!this.closed) {
      this.socket.write(`${JSON.stringify(message)}\n`);
    }
  }

  private receive(chunk: string): void {
    let lines: string[];
    try {
      lines = this.lines.push(chunk);
    } catch {
      this.socket.destroy();
      return;
    }
    for (const line of lines) {
      const message = parseRpcMessage(line);
      switch (message.kind) {
        case 'call':
          if (message.id !== null) {
            this.write({ jsonrpc: '2.0', result: null, id: message.id });
          }
          this.handlers.onCall(message.method, message.params);
          break;
        case 'result':
        case 'error': {
          const pending = typeof message.id === 'number' ? this.pending.get(message.id) : undefined;
          if (pending) {
            this.pending.delete(message.id as number);
            clearTimeout(pending.timeout);
            if (message.kind === 'result') {
              pending.resolve(message.result);
            } else {
              pending.reject(new Error(message.message));
            }
          }
          break;
        }
        case 'invalid':
          console.warn('Ignoring malformed message from the ICE adapter');
          break;
      }
    }
  }

  private finish(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(t('main.ice.connectionClosed')));
    }
    this.pending.clear();
    this.handlers.onClose();
  }
}

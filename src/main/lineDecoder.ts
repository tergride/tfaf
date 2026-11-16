import { t } from './i18n.ts';

const MAX_LINE_BUFFER = 8 * 1024 * 1024;

/**
 * Splits a stream of text chunks into complete lines. Used for the newline-delimited JSON of the lobby server and the
 * JSON-RPC interface of the ICE adapter, where a message may span several network reads.
 */
export class LineDecoder {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE_BUFFER) {
      this.buffer = '';
      throw new Error(t('main.net.lineTooLong'));
    }
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    return lines.map((line) => line.trim()).filter((line) => line.length > 0);
  }
}

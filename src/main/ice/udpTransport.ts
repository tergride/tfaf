// The UDP sockets the ICE agent talks through. Production uses node:dgram; tests plug in a simulated network with NATs,
// loss and outages.

import dgram from 'node:dgram';
import type { Address } from './stun.ts';

export interface UdpSocket {
  /** Binds exclusively to the address; port 0 picks a free one. */
  bind(address: string, port: number): Promise<void>;
  /** Fire and forget: send errors count as packet loss. */
  send(data: Buffer, to: Address): void;
  onMessage(listener: (data: Buffer, from: Address) => void): void;
  onError(listener: (error: Error) => void): void;
  address(): Address;
  close(): void;
}

export interface UdpTransport {
  createSocket(): UdpSocket;
}

class SystemUdpSocket implements UdpSocket {
  private readonly socket = dgram.createSocket('udp4');
  private closed = false;

  bind(address: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind({ address, port, exclusive: true }, () => {
        this.socket.off('error', reject);
        resolve();
      });
    });
  }

  send(data: Buffer, to: Address): void {
    if (this.closed) {
      return;
    }
    try {
      this.socket.send(data, to.port, to.address, () => {});
    } catch {
      // The socket is already closed.
    }
  }

  onMessage(listener: (data: Buffer, from: Address) => void): void {
    this.socket.on('message', (data, info) => listener(data, { address: info.address, port: info.port }));
  }

  onError(listener: (error: Error) => void): void {
    this.socket.on('error', listener);
  }

  address(): Address {
    const { address, port } = this.socket.address();
    return { address, port };
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.socket.close();
    } catch {
      // Closed before it was bound.
    }
  }
}

export const systemUdp: UdpTransport = {
  createSocket: () => new SystemUdpSocket(),
};

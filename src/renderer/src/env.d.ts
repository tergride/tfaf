import type { TfafApi } from '../../shared/contract.ts';

declare global {
  interface Window {
    tfaf: TfafApi;
  }
}

export {};

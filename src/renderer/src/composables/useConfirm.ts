import { shallowRef } from 'vue';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText: string;
  destructive?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

const pending = shallowRef<PendingConfirm | null>(null);

/** Asks for confirmation in the app's own dialog; a newer request cancels the one still open. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  pending.value?.resolve(false);
  return new Promise((resolve) => {
    pending.value = { ...options, resolve };
  });
}

export function useConfirmDialog() {
  function settle(confirmed: boolean): void {
    const current = pending.value;
    pending.value = null;
    current?.resolve(confirmed);
  }
  return { pending, settle };
}

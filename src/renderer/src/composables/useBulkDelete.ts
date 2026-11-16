import { ref } from 'vue';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { confirmAction } from './useConfirm.ts';
import { type BulkSelection, type BulkSelectionOptions, useBulkSelection } from './useBulkSelection.ts';

export interface BulkDeleteOptions<T> extends BulkSelectionOptions<T> {
  name: (item: T) => string;
  confirmTitle: (count: number) => string;
  remove: (item: T) => Promise<void>;
  /** After the deletions, such as reading the list again; deleted items then leave the selection by themselves. */
  done: () => Promise<void>;
}

// The confirmation names this many items and counts the rest.
const NAMED_ITEMS = 5;

/** Ticked items of a list to delete together: one confirmation, then one by one, failures listed and left ticked. */
export function useBulkDelete<T>(options: BulkDeleteOptions<T>) {
  const selection: BulkSelection<T> = useBulkSelection(options);
  const busy = ref(false);
  const error = ref<string | null>(null);

  async function deleteSelected(): Promise<void> {
    const items = selection.selectedItems.value;
    if (items.length === 0 || busy.value) {
      return;
    }
    const names = items.slice(0, NAMED_ITEMS).map((item) => `«${options.name(item)}»`);
    const rest = items.length - names.length;
    const confirmed = await confirmAction({
      title: options.confirmTitle(items.length),
      description: t('vault.bulk.deleteDescription', {
        names: rest > 0 ? `${names.join(', ')} ${t('vault.bulk.andMore', { count: rest })}` : names.join(', '),
      }),
      confirmText: t('common.delete'),
      destructive: true,
    });
    if (!confirmed) {
      return;
    }
    busy.value = true;
    error.value = null;
    const failed: string[] = [];
    try {
      for (const item of items) {
        try {
          await options.remove(item);
        } catch (cause) {
          failed.push(`${options.name(item)}: ${errorMessage(cause)}`);
        }
      }
      await options.done();
    } catch (cause) {
      failed.push(errorMessage(cause));
    } finally {
      busy.value = false;
    }
    error.value = failed.length > 0 ? t('vault.bulk.failed', { details: failed.join('; ') }) : null;
  }

  return { selection, busy, error, deleteSelected };
}

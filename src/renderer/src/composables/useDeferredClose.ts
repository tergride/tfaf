import { ref } from 'vue';

/**
 * For a dialog that its parent mounts with v-if: closing first plays the exit animation, and only then
 * the parent hears about it and unmounts the component. Bind `open` to the dialog root, call `close` to close, and
 * pass `onContentClosed` to the content's close-auto-focus, which reka-ui emits once the content is gone.
 */
export function useDeferredClose(onClosed: () => void) {
  const open = ref(true);
  return {
    open,
    close(): void {
      open.value = false;
    },
    onContentClosed(): void {
      // The content also goes away when the parent unmounts the component itself; that is not a close to report.
      if (!open.value) {
        onClosed();
      }
    },
  };
}

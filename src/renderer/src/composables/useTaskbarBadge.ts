import { type Ref, watch } from 'vue';

// Windows shows the overlay at 16 px; drawn at twice that it stays sharp on scaled displays.
const SIZE = 32;

function drawBadge(count: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext('2d');
  if (!context) {
    return '';
  }
  const styles = getComputedStyle(document.documentElement);
  context.fillStyle = styles.getPropertyValue('--color-destructive').trim() || '#e5484d';
  context.beginPath();
  context.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
  context.fill();
  const text = count > 99 ? '99+' : String(count);
  context.fillStyle = '#ffffff';
  context.font = `700 ${text.length > 2 ? 13 : text.length > 1 ? 17 : 21}px "IBM Plex Sans Variable", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, SIZE / 2, SIZE / 2 + 1);
  return canvas.toDataURL('image/png');
}

/** The count of what waits for the user (private messages, mentions, unread notifications) on the taskbar button. */
export function useTaskbarBadge(count: Ref<number>): void {
  watch(
    count,
    (value) => {
      const image = value > 0 ? drawBadge(value) : null;
      window.tfaf.appWindow
        .setBadge(image ? value : 0, image)
        .catch((error: unknown) => console.warn('Taskbar badge could not be set', error));
    },
    { immediate: true },
  );
}

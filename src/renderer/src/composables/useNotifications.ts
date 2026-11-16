import { computed, readonly, shallowReactive, shallowRef } from 'vue';
import type { AppNotification, NotificationPrefs } from '../../../shared/contract.ts';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';

const MAX_TOASTS = 4;

const items = shallowRef<AppNotification[]>([]);
const toasts = shallowRef<AppNotification[]>([]);
// Until the settings answer, toasts show at the defaults.
const prefs = shallowReactive<Pick<NotificationPrefs, 'toasts' | 'toastPosition' | 'toastSeconds'>>({
  toasts: true,
  toastPosition: 'bottomRight',
  toastSeconds: 5,
});
let initialized = false;

/** Applies the toast settings saved in the settings. */
export function setNotificationPrefs(next: NotificationPrefs): void {
  prefs.toasts = next.toasts;
  prefs.toastPosition = next.toastPosition;
  prefs.toastSeconds = next.toastSeconds;
}

/** `always` is for an error that the bell does not keep: it shows even with the toasts switched off. */
function showToast(notification: AppNotification, always = false): void {
  if (prefs.toasts || always) {
    toasts.value = [...toasts.value, notification].slice(-MAX_TOASTS);
  }
}

function hideToast(id: string): void {
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}

/** Runs an action, or the click on the notification itself; a failure is shown as a toast of its own. */
async function act(notification: AppNotification, actionId: string | null): Promise<void> {
  hideToast(notification.id);
  try {
    await window.tfaf.notifications.act(notification.id, actionId);
  } catch (error) {
    const failure: AppNotification = {
      id: crypto.randomUUID(),
      severity: 'error',
      title: t('notifications.actionFailed', { error: errorMessage(error) }),
      body: '',
      createdAt: new Date().toISOString(),
      read: true,
      actions: [],
      clickable: false,
      transient: true,
    };
    showToast(failure, true);
  }
}

export function useNotifications() {
  if (!initialized) {
    initialized = true;
    let received = false;
    window.tfaf.notifications.onChanged((next) => {
      received = true;
      items.value = next;
    });
    window.tfaf.notifications.onAdded((notification) => showToast(notification, notification.transient && notification.severity === 'error'));
    void window.tfaf.notifications.list().then((initial) => {
      if (!received) {
        items.value = initial;
      }
    });
  }

  return {
    /** Newest first. */
    items,
    unread: computed(() => items.value.filter((item) => !item.read).length),
    toasts,
    prefs: readonly(prefs),
    hideToast,
    act,
    markAllRead: (): Promise<void> => window.tfaf.notifications.markAllRead(),
    dismiss: (id: string): Promise<void> => window.tfaf.notifications.dismiss(id),
    clear: (): Promise<void> => window.tfaf.notifications.clear(),
  };
}

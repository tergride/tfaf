import { randomUUID } from 'node:crypto';
import type { AppNotification, NotificationSeverity } from '../shared/contract.ts';

export interface NotificationActionSpec {
  label: string;
  run: () => void | Promise<void>;
  /** The notification stays after the action ran, e.g. "open the chat"; by default it goes away. */
  keep?: boolean;
}

export interface NotificationSpec {
  severity: NotificationSeverity;
  title: string;
  body?: string;
  actions?: NotificationActionSpec[];
  /** What a click on the notification itself does. */
  onClick?: () => void | Promise<void>;
  /** A toast only: not kept in the list and not counted as unread. */
  transient?: boolean;
}

export interface NotificationCenterEvents {
  onChanged(notifications: AppNotification[]): void;
  onAdded(notification: AppNotification): void;
}

interface Entry {
  notification: AppNotification;
  actions: Map<string, NotificationActionSpec>;
  onClick: (() => void | Promise<void>) | null;
}

const MAX_NOTIFICATIONS = 100;
// Toasts of transient notifications stay clickable for a while; older handlers are dropped.
const MAX_TRANSIENT = 20;

/** The notifications of the bell in the title bar and the toasts; kept in memory for the session. */
export class NotificationCenter {
  private readonly events: NotificationCenterEvents;
  /** Newest first. */
  private entries: Entry[] = [];
  private transient: Entry[] = [];

  constructor(events: NotificationCenterEvents) {
    this.events = events;
  }

  add(spec: NotificationSpec): AppNotification {
    const actions = new Map((spec.actions ?? []).map((action, index) => [`action-${index}`, action]));
    const notification: AppNotification = {
      id: randomUUID(),
      severity: spec.severity,
      title: spec.title,
      body: spec.body ?? '',
      createdAt: new Date().toISOString(),
      read: false,
      actions: [...actions].map(([id, action]) => ({ id, label: action.label })),
      clickable: spec.onClick !== undefined,
      transient: spec.transient === true,
    };
    const entry: Entry = { notification, actions, onClick: spec.onClick ?? null };
    if (notification.transient) {
      this.transient = [entry, ...this.transient].slice(0, MAX_TRANSIENT);
    } else {
      this.entries = [entry, ...this.entries].slice(0, MAX_NOTIFICATIONS);
      this.changed();
    }
    this.events.onAdded(notification);
    return notification;
  }

  list(): AppNotification[] {
    return this.entries.map((entry) => entry.notification);
  }

  unreadCount(): number {
    return this.entries.filter((entry) => !entry.notification.read).length;
  }

  markAllRead(): void {
    if (this.unreadCount() === 0) {
      return;
    }
    this.entries = this.entries.map((entry) => ({ ...entry, notification: { ...entry.notification, read: true } }));
    this.changed();
  }

  dismiss(id: string): void {
    const remaining = this.entries.filter((entry) => entry.notification.id !== id);
    if (remaining.length !== this.entries.length) {
      this.entries = remaining;
      this.changed();
    }
    this.transient = this.transient.filter((entry) => entry.notification.id !== id);
  }

  clear(): void {
    if (this.entries.length > 0) {
      this.entries = [];
      this.changed();
    }
  }

  /** Runs an action, or the click on the notification when `actionId` is null; unknown ones are ignored. */
  async act(id: string, actionId: string | null): Promise<void> {
    const entry = [...this.entries, ...this.transient].find((candidate) => candidate.notification.id === id);
    if (!entry) {
      return;
    }
    const action = actionId === null ? null : entry.actions.get(actionId);
    const run = actionId === null ? entry.onClick : action?.run;
    if (!run) {
      return;
    }
    await run();
    if (action && !action.keep) {
      this.dismiss(id);
    } else {
      this.markRead(id);
    }
  }

  private markRead(id: string): void {
    const index = this.entries.findIndex((entry) => entry.notification.id === id);
    const entry = this.entries[index];
    if (entry && !entry.notification.read) {
      this.entries = this.entries.with(index, { ...entry, notification: { ...entry.notification, read: true } });
      this.changed();
    }
  }

  private changed(): void {
    this.events.onChanged(this.list());
  }
}

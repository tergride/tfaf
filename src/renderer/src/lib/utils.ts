import type { ClassValue } from 'clsx';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names and lets later Tailwind classes override earlier ones, as shadcn-vue components expect. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** The title bar stays usable above a modal; pressing its window buttons must not dismiss the modal. */
export function keepOpenForWindowControls(event: CustomEvent<{ originalEvent: Event }>): void {
  const target = event.detail.originalEvent.target;
  if (target instanceof Element && target.closest('[data-window-controls]')) {
    event.preventDefault();
  }
}

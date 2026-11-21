<script setup lang="ts">
import { useEventListener } from '@vueuse/core';
import { onBeforeUnmount, ref, shallowRef } from 'vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { tooltipText } from '../lib/tooltipText.ts';

// The hints of the whole app, in place of the browser's `title`: an element names its text in `data-tooltip`, and this
// one tooltip follows the pointer and the keyboard between such elements. It takes no part in what lists render.
const SHOW_DELAY_MS = 150;
const CHECK_INTERVAL_MS = 200;
const LISTENING = { capture: true, passive: true };

const open = ref(false);
const anchor = shallowRef<HTMLElement | null>(null);
const text = ref('');
/** What the pointer is over. A click hides the hint, and it stays hidden until the pointer leaves that element. */
let hovered: HTMLElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let checkTimer: ReturnType<typeof setInterval> | undefined;

function hinted(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null;
}

function hide(): void {
  clearTimeout(showTimer);
  clearInterval(checkTimer);
  open.value = false;
}

function hintOf(element: HTMLElement | null): string | null {
  return element?.isConnected ? tooltipText(element) : null;
}

const OPEN_LAYERS = '[role=dialog][data-state=open], [role=menu][data-state=open], [role=listbox][data-state=open]';

/**
 * A hint is a layer of its own, and Escape goes to the highest layer: a hint of the page behind an open popover, menu
 * or dialog would take the first Escape, and the popover would stay. Such hints wait until the layer closes.
 */
function behindOpenLayer(element: HTMLElement): boolean {
  const layers = [...document.querySelectorAll(OPEN_LAYERS)];
  return layers.length > 0 && !layers.some((layer) => layer.contains(element));
}

/** No event tells when an element goes away or changes its hint under a resting pointer. */
function refresh(): void {
  const hint = anchor.value && behindOpenLayer(anchor.value) ? null : hintOf(anchor.value);
  if (hint) {
    text.value = hint;
  } else {
    hide();
  }
}

function show(element: HTMLElement): void {
  const hint = behindOpenLayer(element) ? null : hintOf(element);
  if (!hint) {
    hide();
    return;
  }
  anchor.value = element;
  text.value = hint;
  open.value = true;
  clearInterval(checkTimer);
  checkTimer = setInterval(refresh, CHECK_INTERVAL_MS);
}

useEventListener(
  document,
  'pointerover',
  (event: PointerEvent) => {
    const element = hinted(event.target);
    if (element === hovered) {
      return;
    }
    hovered = element;
    clearTimeout(showTimer);
    if (!element) {
      hide();
    } else if (open.value) {
      show(element);
    } else {
      showTimer = setTimeout(() => show(element), SHOW_DELAY_MS);
    }
  },
  LISTENING,
);
useEventListener(
  document,
  'pointerout',
  (event: PointerEvent) => {
    if (!event.relatedTarget) {
      hovered = null;
      hide();
    }
  },
  LISTENING,
);
useEventListener(
  document,
  'focusin',
  (event: FocusEvent) => {
    const element = hinted(event.target);
    if (element && event.target instanceof Element && event.target.matches(':focus-visible')) {
      show(element);
    }
  },
  LISTENING,
);
useEventListener(document, ['focusout', 'pointerdown', 'dragstart', 'scroll'], hide, LISTENING);
useEventListener(
  document,
  'keydown',
  (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      hide();
    }
  },
  LISTENING,
);
useEventListener(window, 'blur', hide);
onBeforeUnmount(hide);
</script>

<template>
  <Tooltip :open="open" disable-hoverable-content @update:open="(value) => !value && hide()">
    <TooltipTrigger as="span" class="hidden" :reference="anchor ?? undefined" />
    <!-- Without the label its copy for screen readers keeps the first text: this one tooltip never remounts. It stays in
         the DOM before a dialog opened later, so it needs a higher layer than dialogs to show over them. -->
    <TooltipContent class="z-100 max-w-80 wrap-anywhere whitespace-pre-line duration-75" :aria-label="text">{{ text }}</TooltipContent>
  </Tooltip>
</template>

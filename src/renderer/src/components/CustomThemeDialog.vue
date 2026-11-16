<script setup lang="ts">
import { ChevronDown, Palette, X } from '@lucide/vue';
import { computed, reactive, ref, useId } from 'vue';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { BUILT_IN_THEMES, type BuiltInTheme, type CustomTheme, type ThemeColor } from '../../../shared/contract.ts';
import { isThemeColor, THEME_COLOR_GROUPS, THEME_COLOR_KEYS, THEME_PALETTES, themeStyle } from '../../../shared/themes.ts';
import { useDeferredClose } from '../composables/useDeferredClose.ts';
import { errorMessage } from '../format.ts';
import { t } from '../lib/i18n.ts';
import ThemePreview from './ThemePreview.vue';

const props = defineProps<{ theme: CustomTheme; save: (theme: CustomTheme) => Promise<boolean> }>();
const emit = defineEmits<{ close: [] }>();
const { open, close, onContentClosed } = useDeferredClose(() => emit('close'));
const id = useId();
const draft = ref<CustomTheme>({ controls: props.theme.controls, colors: { ...props.theme.colors } });
const fields = reactive({ ...draft.value.colors });
const source = ref<BuiltInTheme>('default');
const saving = ref(false);
const error = ref<string | null>(null);
const valid = computed(() => THEME_COLOR_KEYS.every((key) => isThemeColor(fields[key].trim())));
const shellStyle = themeStyle(THEME_PALETTES.default);

function editColor(key: ThemeColor, value: string | number): void {
  fields[key] = String(value);
  const color = fields[key].trim();
  if (isThemeColor(color)) {
    draft.value.colors[key] = color.toLowerCase();
  }
}

function loadPalette(): void {
  const colors = { ...THEME_PALETTES[source.value] };
  draft.value.colors = colors;
  Object.assign(fields, colors);
}

function requestClose(): void {
  if (!saving.value) close();
}

async function submit(): Promise<void> {
  if (!valid.value || saving.value) return;
  saving.value = true;
  error.value = null;
  try {
    // Only plain values cross IPC; the reactive draft stays local and survives a failed save.
    if (await props.save({ controls: draft.value.controls, colors: { ...draft.value.colors } })) {
      close();
    } else {
      error.value = t('settings.interface.custom.saveError');
    }
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && requestClose()">
    <DialogContent
      data-theme="default"
      :style="shellStyle"
      :show-close-button="false"
      class="flex max-h-[calc(100dvh-var(--titlebar-height)-2rem)] flex-col gap-0 overflow-hidden p-0 text-foreground sm:max-w-[min(70rem,calc(100%-2rem))]"
      @close-auto-focus="onContentClosed"
      @escape-key-down="(event) => saving && event.preventDefault()"
      @interact-outside="(event) => saving && event.preventDefault()"
    >
      <DialogHeader class="shrink-0 gap-1.5 border-b px-6 py-5 pr-16">
        <DialogTitle class="flex items-center gap-2.5 font-display text-lg"><Palette class="size-5 text-primary" />{{ t('settings.interface.custom.title') }}</DialogTitle>
        <DialogDescription>{{ t('settings.interface.custom.description') }}</DialogDescription>
      </DialogHeader>
      <Button variant="ghost" size="icon-sm" class="absolute top-4 right-4" :aria-label="t('common.close')" :disabled="saving" @click="requestClose"><X /></Button>

      <div class="min-h-0 overflow-y-auto px-6 py-5">
        <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <fieldset :disabled="saving" class="flex min-w-0 flex-col gap-6">
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="flex min-w-0 flex-col gap-2">
                <label :for="`${id}-controls`" class="text-sm font-medium">{{ t('settings.interface.custom.controls') }}</label>
                <div class="relative">
                  <select :id="`${id}-controls`" v-model="draft.controls" class="plate plate-control plate-focus cut-sm h-9 w-full appearance-none bg-background pr-9 pl-3 text-sm">
                    <option v-for="builtIn in BUILT_IN_THEMES" :key="builtIn" :value="builtIn">{{ t(`settings.interface.themes.${builtIn}`) }}</option>
                  </select>
                  <ChevronDown class="pointer-events-none absolute top-2.5 right-3 size-4 text-muted-foreground" />
                </div>
                <p class="text-xs text-muted-foreground">{{ t('settings.interface.custom.controlsHint') }}</p>
              </div>
              <div class="flex min-w-0 flex-col gap-2">
                <label :for="`${id}-palette`" class="text-sm font-medium">{{ t('settings.interface.custom.palette') }}</label>
                <div class="flex gap-2">
                  <div class="relative min-w-0 flex-1">
                    <select :id="`${id}-palette`" v-model="source" class="plate plate-control plate-focus cut-sm h-9 w-full appearance-none bg-background pr-8 pl-3 text-sm">
                      <option v-for="builtIn in BUILT_IN_THEMES" :key="builtIn" :value="builtIn">{{ t(`settings.interface.themes.${builtIn}`) }}</option>
                    </select>
                    <ChevronDown class="pointer-events-none absolute top-2.5 right-2.5 size-4 text-muted-foreground" />
                  </div>
                  <Button variant="outline" @click="loadPalette">{{ t('settings.interface.custom.load') }}</Button>
                </div>
                <p class="text-xs text-muted-foreground">{{ t('settings.interface.custom.paletteHint') }}</p>
              </div>
            </div>

            <section v-for="group in THEME_COLOR_GROUPS" :key="group.id" :aria-labelledby="`${id}-${group.id}`">
              <h3 :id="`${id}-${group.id}`" class="mb-2 flex items-center gap-2 border-b pb-2 text-sm">
                {{ t(`settings.interface.custom.groups.${group.id}`) }}
                <span class="font-sans text-xs font-normal text-faint">{{ group.colors.length }}</span>
              </h3>
              <div class="grid gap-x-5 sm:grid-cols-2">
                <div v-for="key in group.colors" :key="key" class="grid grid-cols-[minmax(0,1fr)_1.75rem_5.5rem] items-center gap-x-2 gap-y-1 py-2">
                  <label :for="`${id}-${key}`" class="text-[13px] leading-snug">{{ t(`settings.interface.custom.colors.${key}`) }}</label>
                  <input
                    type="color"
                    :value="draft.colors[key]"
                    :aria-label="t('settings.interface.custom.colorPicker', { color: t(`settings.interface.custom.colors.${key}`) })"
                    class="theme-color-picker h-7 w-7 cursor-pointer border border-input bg-background p-0.5 focus-visible:outline-2 focus-visible:outline-ring"
                    @input="editColor(key, ($event.target as HTMLInputElement).value)"
                  />
                  <Input
                    :id="`${id}-${key}`"
                    :model-value="fields[key]"
                    :aria-invalid="!isThemeColor(fields[key].trim())"
                    :aria-describedby="!isThemeColor(fields[key].trim()) ? `${id}-${key}-error` : undefined"
                    :aria-label="t('settings.interface.custom.hexLabel', { color: t(`settings.interface.custom.colors.${key}`) })"
                    :placeholder="t('settings.interface.custom.hexPlaceholder')"
                    class="h-8 px-2 font-mono text-xs md:text-xs"
                    maxlength="7"
                    spellcheck="false"
                    autocomplete="off"
                    @update:model-value="editColor(key, $event)"
                  />
                  <p v-if="!isThemeColor(fields[key].trim())" :id="`${id}-${key}-error`" class="col-span-3 text-xs text-destructive">{{ t('settings.interface.custom.hexError') }}</p>
                </div>
              </div>
            </section>
          </fieldset>

          <aside class="theme-preview-aside flex min-w-0 flex-col gap-2.5" :aria-label="t('settings.interface.custom.preview')">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-sm">{{ t('settings.interface.custom.preview') }}</h3>
              <span class="text-xs text-muted-foreground">{{ t(`settings.interface.themes.${draft.controls}`) }}</span>
            </div>
            <ThemePreview :theme="draft" />
            <p class="text-xs text-muted-foreground">{{ t('settings.interface.custom.previewHint') }}</p>
          </aside>
        </div>
      </div>

      <DialogFooter class="shrink-0 items-center border-t px-6 py-4">
        <p v-if="error" role="alert" class="mr-auto text-sm text-destructive">{{ error }}</p>
        <Button variant="ghost" :disabled="saving" @click="requestClose">{{ t('common.cancel') }}</Button>
        <Button :disabled="!valid || saving" @click="submit"><Spinner v-if="saving" />{{ t('common.save') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.theme-color-picker::-webkit-color-swatch-wrapper { padding: 0; }
.theme-color-picker::-webkit-color-swatch { border: 0; }
/* A short window scrolls the entire preview; a taller one has room to keep it beside the colour fields. */
@media (min-width: 1024px) and (min-height: 800px) {
  .theme-preview-aside { position: sticky; top: 0; }
}
</style>

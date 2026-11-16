<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  DATE_FORMATS,
  type CustomTheme,
  INTERFACE_SCALES,
  type Language,
  LANGUAGES,
  type Settings,
  type SettingsPatch,
  type Theme,
  TIME_FORMATS,
} from '../../../shared/contract.ts';
import { translate } from '../../../shared/i18n/index.ts';
import { formatDateTime } from '../format.ts';
import { t } from '../lib/i18n.ts';
import { applyLanguageSettings } from '../lib/language.ts';
import { setAnimations } from '../lib/motion.ts';
import { setTheme } from '../lib/theme.ts';
import FilterChip from './FilterChip.vue';
import type { SettingsUpdate } from './settingsTab.ts';
import ThemePicker from './ThemePicker.vue';

const props = defineProps<{ settings: Settings; update: SettingsUpdate; serverName: string }>();
const CustomThemeDialog = defineAsyncComponent(() => import('./CustomThemeDialog.vue'));
const customThemeOpen = ref(false);

// The interface follows the switch at once; if saving fails, it goes back to the stored value.
async function setAnimationsEnabled(value: boolean): Promise<void> {
  setAnimations(value);
  const saved = await props.update({ animations: value });
  setAnimations((saved ?? props.settings).animations);
}

async function chooseTheme(value: Theme): Promise<void> {
  setTheme({ ...props.settings, theme: value });
  const saved = await props.update({ theme: value });
  setTheme(saved ?? props.settings);
}

async function saveCustomTheme(customTheme: CustomTheme): Promise<boolean> {
  const saved = await props.update({ theme: 'custom', customTheme });
  if (!saved) return false;
  setTheme(saved);
  return true;
}

/** The interface switches to what was saved, so a failed save leaves it as it was. */
async function updateLanguage(patch: Pick<SettingsPatch, 'language' | 'dateFormat' | 'timeFormat'>): Promise<void> {
  const saved = await props.update(patch);
  if (saved) {
    applyLanguageSettings(saved);
  }
}

/** Each language is named in itself, so it can be found whatever the current one is. */
function languageLabel(language: Language): string {
  return language === 'system' ? t('settings.language.system') : translate(language, 'settings.languageName');
}

const formatExample = computed(() => t('settings.language.example', { example: formatDateTime(new Date().toISOString()) ?? '' }));
</script>

<template>
  <div class="flex flex-col gap-5">
    <Card class="gap-0 py-0">
      <CardHeader class="border-b py-4">
        <CardTitle>{{ t('settings.startup.title') }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col px-0">
        <Label class="flex cursor-pointer items-start gap-3 px-6 py-4 font-normal">
          <Switch
            :model-value="settings.updateContentOnHost"
            class="mt-0.5"
            @update:model-value="(value) => update({ updateContentOnHost: value })"
          />
          <span class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.startup.updateContentOnHost') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.startup.updateContentOnHostHint') }}</span>
          </span>
        </Label>
        <Separator />
        <Label class="flex cursor-pointer items-start gap-3 px-6 py-4 font-normal">
          <Switch
            :model-value="settings.rememberMe"
            class="mt-0.5"
            @update:model-value="(value) => update({ rememberMe: value })"
          />
          <span class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.startup.rememberMe') }}</span>
            <span class="text-[13px] text-muted-foreground">
              {{ t('settings.startup.rememberMeHint', { server: serverName }) }}
            </span>
          </span>
        </Label>
      </CardContent>
    </Card>

    <Card class="gap-0 py-0">
      <CardHeader class="border-b py-4">
        <CardTitle>{{ t('settings.window.title') }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col px-0">
        <Label class="flex cursor-pointer items-start gap-3 px-6 py-4 font-normal">
          <Switch
            :model-value="settings.closeToTray"
            class="mt-0.5"
            @update:model-value="(value) => update({ closeToTray: value })"
          />
          <span class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.window.closeToTray') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.window.closeToTrayHint') }}</span>
          </span>
        </Label>
        <Separator />
        <Label class="flex cursor-pointer items-start gap-3 px-6 py-4 font-normal">
          <Switch
            :model-value="settings.confirmQuit"
            class="mt-0.5"
            @update:model-value="(value) => update({ confirmQuit: value })"
          />
          <span class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.window.confirmQuit') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.window.confirmQuitHint') }}</span>
          </span>
        </Label>
      </CardContent>
    </Card>

    <Card class="gap-0 py-0">
      <CardHeader class="border-b py-4">
        <CardTitle>{{ t('settings.interface.title') }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col px-0">
        <div class="flex flex-col gap-3 px-6 py-4">
          <div class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.interface.theme') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.interface.themeHint') }}</span>
          </div>
          <ThemePicker :model-value="settings.theme" :custom-theme="settings.customTheme" @update:model-value="chooseTheme" @customize="customThemeOpen = true" />
        </div>
        <Separator />
        <Label class="flex cursor-pointer items-start gap-3 px-6 py-4 font-normal">
          <Switch :model-value="settings.animations" class="mt-0.5" @update:model-value="setAnimationsEnabled" />
          <span class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.interface.animations') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.interface.animationsHint') }}</span>
          </span>
        </Label>
        <Separator />
        <div class="flex flex-col gap-3 px-6 py-4">
          <div class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.interface.scale') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.interface.scaleHint') }}</span>
          </div>
          <div class="flex flex-wrap gap-0.75" role="group" :aria-label="t('settings.interface.scale')">
            <FilterChip
              v-for="scale in INTERFACE_SCALES"
              :key="scale"
              :pressed="settings.interfaceScale === scale"
              @toggle="scale !== settings.interfaceScale && update({ interfaceScale: scale })"
            >
              {{ scale }} %
            </FilterChip>
          </div>
        </div>
      </CardContent>
    </Card>

    <Card class="gap-0 py-0">
      <CardHeader class="border-b py-4">
        <CardTitle>{{ t('settings.language.title') }}</CardTitle>
      </CardHeader>
      <CardContent class="flex flex-col px-0">
        <div class="flex flex-col gap-3 px-6 py-4">
          <div class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.language.language') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.language.languageHint') }}</span>
          </div>
          <div class="flex flex-wrap gap-0.75" role="group" :aria-label="t('settings.language.language')">
            <FilterChip
              v-for="language in LANGUAGES"
              :key="language"
              :pressed="settings.language === language"
              @toggle="language !== settings.language && updateLanguage({ language })"
            >
              {{ languageLabel(language) }}
            </FilterChip>
          </div>
        </div>
        <Separator />
        <div class="flex flex-col gap-3 px-6 py-4">
          <div class="flex flex-col gap-1">
            <span class="font-medium">{{ t('settings.language.dateFormat') }}</span>
            <span class="text-[13px] text-muted-foreground">{{ t('settings.language.formatHint') }}</span>
          </div>
          <div class="flex flex-wrap gap-0.75" role="group" :aria-label="t('settings.language.dateFormat')">
            <FilterChip
              v-for="format in DATE_FORMATS"
              :key="format"
              :pressed="settings.dateFormat === format"
              @toggle="format !== settings.dateFormat && updateLanguage({ dateFormat: format })"
            >
              {{ format === 'auto' ? t('settings.language.auto') : t(`settings.language.dateFormats.${format}`) }}
            </FilterChip>
          </div>
          <span class="font-medium">{{ t('settings.language.timeFormat') }}</span>
          <div class="flex flex-wrap gap-0.75" role="group" :aria-label="t('settings.language.timeFormat')">
            <FilterChip
              v-for="format in TIME_FORMATS"
              :key="format"
              :pressed="settings.timeFormat === format"
              @toggle="format !== settings.timeFormat && updateLanguage({ timeFormat: format })"
            >
              {{ format === 'auto' ? t('settings.language.auto') : t(`settings.language.timeFormats.${format}`) }}
            </FilterChip>
          </div>
          <span class="text-[13px] text-muted-foreground tabular-nums">{{ formatExample }}</span>
        </div>
      </CardContent>
    </Card>
  </div>
  <CustomThemeDialog v-if="customThemeOpen" :theme="settings.customTheme" :save="saveCustomTheme" @close="customThemeOpen = false" />
</template>

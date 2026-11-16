<script setup lang="ts">
import { ref, useId } from 'vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import type { CustomTheme } from '../../../shared/contract.ts';
import { themeStyle } from '../../../shared/themes.ts';
import { t } from '../lib/i18n.ts';

defineProps<{ theme: CustomTheme }>();
const id = useId();
const enabled = ref(true);
const checked = ref<boolean | 'indeterminate'>(true);
const radio = ref('first');
const level = ref([65]);
const text = ref('');
</script>

<template>
  <div :data-theme="theme.controls" :style="themeStyle(theme.colors)" class="flex flex-col gap-2.5 bg-background p-3 text-foreground" data-theme-preview>
    <div class="flex items-center justify-between gap-3 bg-hull px-3 py-2">
      <span class="font-display text-sm font-semibold">{{ t('settings.interface.custom.previewTitle') }}</span>
      <span class="size-1.5 bg-primary" aria-hidden="true" />
    </div>
    <Card class="gap-3 py-3">
      <CardHeader class="gap-1 px-3">
        <CardTitle class="text-base">{{ t('settings.interface.custom.previewPanel') }}</CardTitle>
        <p class="text-[13px] text-muted-foreground">{{ t('settings.interface.custom.previewDescription') }}</p>
      </CardHeader>
      <CardContent class="flex flex-col gap-3 px-3">
        <div class="flex flex-wrap gap-2">
          <Button size="sm">{{ t('settings.interface.custom.previewPrimary') }}</Button>
          <Button variant="secondary" size="sm">{{ t('settings.interface.custom.previewSecondary') }}</Button>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label :for="`${id}-field`">{{ t('settings.interface.custom.previewField') }}</Label>
          <Input :id="`${id}-field`" v-model="text" :placeholder="t('settings.interface.custom.previewPlaceholder')" />
        </div>
        <Label class="cursor-pointer justify-between gap-3 leading-snug font-normal">
          {{ t('settings.interface.custom.previewSwitch') }}
          <Switch v-model="enabled" />
        </Label>
        <Label class="cursor-pointer leading-snug font-normal">
          <Checkbox v-model="checked" />
          {{ t('settings.interface.custom.previewCheckbox') }}
        </Label>
        <RadioGroup v-model="radio" class="flex flex-wrap gap-x-4 gap-y-2" :aria-label="t('settings.interface.custom.previewRadio')">
          <Label class="cursor-pointer font-normal"><RadioGroupItem value="first" />{{ t('settings.interface.custom.previewFirst') }}</Label>
          <Label class="cursor-pointer font-normal"><RadioGroupItem value="second" />{{ t('settings.interface.custom.previewSecond') }}</Label>
        </RadioGroup>
        <div class="flex flex-col gap-3">
          <Label :for="`${id}-level`" class="justify-between font-normal">
            {{ t('settings.interface.custom.previewSlider') }}
            <span class="text-muted-foreground tabular-nums">{{ level[0] }} %</span>
          </Label>
          <Slider :id="`${id}-level`" v-model="level" :max="100" :step="1" :aria-label="t('settings.interface.custom.previewSlider')" />
        </div>
        <div class="flex flex-wrap gap-1.5">
          <Badge variant="info">{{ t('settings.interface.custom.previewInfo') }}</Badge>
          <Badge variant="success">{{ t('settings.interface.custom.previewSuccess') }}</Badge>
          <Badge variant="warning">{{ t('settings.interface.custom.previewWarning') }}</Badge>
          <span class="plate plate-control cut-xs bg-destructive/12 px-2 py-0.5 text-xs font-medium text-destructive [--plate-border:var(--color-destructive)]">
            {{ t('settings.interface.custom.previewError') }}
          </span>
        </div>
      </CardContent>
    </Card>
    <div class="plate cut-sm flex flex-col gap-2 bg-popover p-3 text-popover-foreground">
      <span class="text-[13px]">{{ t('settings.interface.custom.previewPopover') }}</span>
      <span class="plate plate-control cut-xs bg-accent px-3 py-1.5 text-[13px] text-accent-foreground [--plate-border:transparent]">
        {{ t('settings.interface.custom.previewAccent') }}
      </span>
      <span class="text-xs text-faint">{{ t('settings.interface.custom.previewFaint') }}</span>
    </div>
  </div>
</template>

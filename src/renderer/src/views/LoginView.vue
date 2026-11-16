<script setup lang="ts">
import { Bot, Check, Copy, ExternalLink, LogIn } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import type { AuthState, ServerId, ServerInfo } from '../../../shared/contract.ts';
import splashUrl from '../assets/splash.jpg';
import { errorMessage, formatTime } from '../format.ts';
import { t } from '../lib/i18n.ts';

const props = defineProps<{ state: AuthState }>();

const servers = ref<ServerInfo[]>([]);
const server = ref<ServerId>(props.state.server);
const rememberMe = ref(true);
const actionError = ref<string | null>(null);
const copied = ref(false);

const busy = computed(() => props.state.status === 'restoring' || props.state.status === 'awaitingApproval');
const error = computed(() => actionError.value ?? (props.state.status === 'signedOut' ? props.state.error : undefined));
const now = ref(Date.now());
const ticker = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(ticker));
const retryIn = computed(() =>
  props.state.status === 'restoring' && props.state.retryAt
    ? Math.max(0, Math.ceil((props.state.retryAt - now.value) / 1000))
    : null,
);
const expiresAt = computed(() =>
  props.state.status === 'awaitingApproval'
    ? formatTime(props.state.expiresAt)
    : null,
);

watch(
  () => props.state.server,
  (value) => {
    server.value = value;
  },
);

onMounted(async () => {
  try {
    const [serverList, settings] = await Promise.all([window.tfaf.servers(), window.tfaf.settings.get()]);
    servers.value = serverList;
    rememberMe.value = settings.rememberMe;
  } catch (cause) {
    actionError.value = errorMessage(cause);
  }
});

function selectServer(value: unknown): void {
  const match = servers.value.find((item) => item.id === value);
  if (match) {
    server.value = match.id;
  }
}

async function login(): Promise<void> {
  actionError.value = null;
  try {
    await window.tfaf.settings.update({ rememberMe: rememberMe.value });
    await window.tfaf.auth.login(server.value);
  } catch (cause) {
    actionError.value = errorMessage(cause);
  }
}

// The FAF files installed by an earlier session, for skirmish against the AI without signing in.
async function skirmish(): Promise<void> {
  actionError.value = null;
  try {
    await window.tfaf.game.skirmish(false);
  } catch (cause) {
    actionError.value = errorMessage(cause);
  }
}

async function cancel(): Promise<void> {
  await window.tfaf.auth.cancelLogin();
}

async function copyCode(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch (cause) {
    actionError.value = errorMessage(cause);
  }
}
</script>

<template>
  <div class="grid h-full grid-cols-[minmax(0,1.1fr)_minmax(420px,1fr)] bg-background">
    <div class="relative overflow-hidden bg-[#081016]">
      <img
        :src="splashUrl"
        alt=""
        draggable="false"
        class="absolute inset-0 m-auto size-[min(88%,640px)] object-contain [mask-image:radial-gradient(circle,black_58%,transparent_71%)]"
      />
      <div class="absolute inset-y-0 right-0 w-1/3 bg-linear-to-r from-transparent to-background" />
    </div>

    <div class="flex items-center justify-center p-10">
      <div class="flex w-full max-w-[400px] flex-col gap-6">
        <div class="flex flex-col gap-1.5">
          <h1 class="text-3xl tracking-wide">{{ t('login.title') }}</h1>
          <p class="text-muted-foreground">{{ t('login.subtitle') }}</p>
        </div>

        <template v-if="state.status === 'awaitingApproval'">
          <div class="plate cut-lg flex flex-col gap-4 bg-card p-5">
            <p class="text-sm">
              {{ t('login.confirmInBrowser') }}
            </p>
            <div class="flex items-center gap-3">
              <code
                class="plate cut-sm bg-primary/8 px-4 py-2 font-mono text-2xl tracking-[0.15em] text-primary selectable [--plate-border:var(--color-primary)]"
              >
                {{ state.userCode }}
              </code>
              <Button variant="outline" size="sm" @click="copyCode(state.userCode)">
                <Check v-if="copied" />
                <Copy v-else />
                {{ copied ? t('login.copied') : t('login.copy') }}
              </Button>
            </div>
            <a
              :href="state.verificationUri"
              target="_blank"
              rel="noopener noreferrer"
              class="flex w-fit items-center gap-1.5 text-sm text-info hover:underline"
            >
              <ExternalLink class="size-3.5" />
              {{ t('login.reopenPage') }}
            </a>
            <p class="text-xs text-muted-foreground">
              {{ t('login.codeExpires', { time: expiresAt ?? '' }) }}
            </p>
          </div>
          <div class="flex items-center gap-2.5 text-muted-foreground">
            <Spinner class="text-primary" />
            {{ t('login.waiting') }}
            <Button variant="ghost" size="sm" class="ml-auto" @click="cancel">{{ t('common.cancel') }}</Button>
          </div>
        </template>

        <div v-else-if="state.status === 'restoring'" class="flex flex-col gap-2">
          <div class="flex items-center gap-2.5 text-muted-foreground">
            <Spinner class="text-primary" />
            {{ state.error ? t('login.retrying') : t('login.restoring') }}
            <Button variant="ghost" size="sm" class="ml-auto" @click="cancel">{{ t('common.cancel') }}</Button>
          </div>
          <p v-if="state.error" class="text-sm text-muted-foreground selectable">
            {{ state.error }}<template v-if="retryIn !== null">. {{ t('login.nextAttempt', { seconds: retryIn }) }}</template>
          </p>
        </div>

        <template v-else>
          <div class="flex flex-col gap-2">
            <span class="text-sm font-medium">{{ t('login.server') }}</span>
            <RadioGroup :model-value="server" @update:model-value="selectServer">
              <Label
                v-for="item in servers"
                :key="item.id"
                class="plate plate-focus-within cut-sm flex cursor-pointer items-center gap-3 bg-card p-3.5 font-normal transition-colors hover:bg-secondary has-data-[state=checked]:bg-primary/6 has-data-[state=checked]:[--plate-border:var(--color-primary)]"
              >
                <RadioGroupItem :value="item.id" />
                <span class="flex flex-col">
                  <span class="font-semibold">{{ item.name }}</span>
                  <span class="text-xs text-muted-foreground">
                    {{ item.id === 'prod' ? 'faforever.com' : t('login.testServerHint') }}
                  </span>
                </span>
              </Label>
            </RadioGroup>
          </div>
          <Label class="cursor-pointer gap-2.5 font-normal">
            <Switch v-model="rememberMe" />
            {{ t('login.rememberMe') }}
          </Label>
          <Button size="lg" class="h-11 text-base" :disabled="busy" @click="login">
            <LogIn />
            {{ t('login.signIn') }}
          </Button>
          <Button variant="ghost" class="self-center text-muted-foreground" :data-tooltip="t('login.skirmishHint')" @click="skirmish">
            <Bot />
            {{ t('login.skirmish') }}
          </Button>
        </template>

        <Alert v-if="error" variant="destructive">
          <AlertDescription class="selectable">{{ error }}</AlertDescription>
        </Alert>
      </div>
    </div>
  </div>
</template>

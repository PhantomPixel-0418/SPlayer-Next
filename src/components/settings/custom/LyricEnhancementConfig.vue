<script setup lang="ts">
import type { AiModelState } from "@shared/types/ai";
import type { LyricDictionaryStatus } from "@shared/types/lyricEnhancement";
import { toast } from "@/composables/useToast";
import AiModelConfig from "@/components/settings/custom/AiModelConfig.vue";

const { t } = useI18n();
const configOpen = ref(false);
const modelState = ref<AiModelState>({ models: [], activeModelId: null });
const dictionary = ref<LyricDictionaryStatus>({
  installed: false,
  downloading: false,
  version: "",
});
const loading = ref(false);
const clearingCache = ref(false);
const error = ref<string | null>(null);

const activeModel = computed(
  () =>
    modelState.value.models.find((model) => model.id === modelState.value.activeModelId) ?? null,
);

/** 通知当前播放歌词重新应用增强设置 */
const notifyEnhancementChanged = (): void => {
  window.dispatchEvent(new Event("lyric-enhancement:changed"));
};

/** 刷新当前使用模型与日语词典状态 */
const refresh = async (): Promise<void> => {
  loading.value = true;
  error.value = null;
  try {
    const [models, status] = await Promise.all([
      window.api.aiModel.list(),
      window.api.lyricEnhancement.dictionaryStatus(),
    ]);
    modelState.value = models;
    dictionary.value = status;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
};

/** 下载日语离线发音词典并更新状态 */
const downloadDictionary = async (): Promise<void> => {
  dictionary.value = { ...dictionary.value, downloading: true };
  error.value = null;
  try {
    dictionary.value = await window.api.lyricEnhancement.downloadDictionary();
    notifyEnhancementChanged();
  } catch (cause) {
    dictionary.value = { ...dictionary.value, downloading: false };
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
};

/** 移除已安装的日语离线发音词典 */
const removeDictionary = async (): Promise<void> => {
  error.value = null;
  try {
    dictionary.value = await window.api.lyricEnhancement.removeDictionary();
    notifyEnhancementChanged();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
};

/** 清除歌词增强缓存 */
const clearCache = async (): Promise<void> => {
  clearingCache.value = true;
  error.value = null;
  try {
    await window.api.lyricEnhancement.clearCache();
    notifyEnhancementChanged();
    toast.success(t("settings.lyricEnhancement.cacheCleared"));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    clearingCache.value = false;
  }
};

watch(configOpen, (open) => {
  if (!open) {
    notifyEnhancementChanged();
    void refresh();
  }
});

onMounted(refresh);
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-solid border-outline-variant/15 bg-surface-panel px-4 py-3"
    >
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-sm font-medium text-on-surface">
          <IconLucideBot class="size-4" />
          {{ t("settings.lyricEnhancement.modelTitle") }}
          <STag size="tiny" type="warning" variant="soft">Beta</STag>
        </div>
        <div class="mt-1 truncate text-xs text-on-surface-variant/70">
          {{
            activeModel
              ? `${activeModel.name} · ${activeModel.model}`
              : t("settings.lyricEnhancement.noModel")
          }}
        </div>
      </div>
      <SButton variant="secondary" size="small" @click="configOpen = true">
        {{ t("settings.lyricEnhancement.configureModel") }}
      </SButton>
    </div>

    <div
      class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-solid border-outline-variant/15 bg-surface-panel px-4 py-3"
    >
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-sm font-medium text-on-surface">
          <IconLucideBookOpen class="size-4" />
          {{ t("settings.lyricEnhancement.dictionaryTitle") }}
        </div>
        <div class="mt-1 text-xs text-on-surface-variant/70">
          {{ t("settings.lyricEnhancement.dictionaryDescription") }}
          <span v-if="dictionary.installed">· {{ t("settings.lyricEnhancement.installed") }}</span>
          <span v-else>· {{ t("settings.lyricEnhancement.notInstalled") }}</span>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <SButton
          v-if="dictionary.installed"
          variant="secondary"
          size="small"
          type="error"
          @click="removeDictionary"
        >
          {{ t("settings.lyricEnhancement.removeDictionary") }}
        </SButton>
        <SButton
          v-else
          variant="secondary"
          size="small"
          :loading="dictionary.downloading"
          :disabled="loading"
          @click="downloadDictionary"
        >
          {{ t("settings.lyricEnhancement.downloadDictionary") }}
        </SButton>
        <SButton variant="secondary" size="small" :loading="clearingCache" @click="clearCache">
          <template #icon><IconLucideTrash2 class="size-4" /></template>
          {{ t("settings.lyricEnhancement.clearCache") }}
        </SButton>
      </div>
    </div>

    <div
      v-if="error"
      role="alert"
      class="break-all rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-500"
    >
      {{ error }}
    </div>

    <SDialog
      v-model:open="configOpen"
      :title="t('settings.lyricEnhancement.configureModel')"
      width="min(760px, 92vw)"
    >
      <AiModelConfig />
    </SDialog>
  </div>
</template>

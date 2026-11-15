<script setup lang="ts">
import type { AiModelState } from "@shared/types/ai";
import { toast } from "@/composables/useToast";
import AiModelConfig from "@/components/settings/custom/AiModelConfig.vue";

const { t } = useI18n();
const configOpen = ref(false);
const modelState = ref<AiModelState>({ models: [], activeModelId: null });
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

/** 刷新当前使用的模型 */
const refresh = async (): Promise<void> => {
  error.value = null;
  try {
    modelState.value = await window.api.aiModel.list();
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
  <div class="flex flex-col gap-2.5">
    <div
      class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-solid border-outline-variant/15 bg-surface-panel px-4 py-3.5 transition-all duration-300"
    >
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-base">
          {{ t("settings.lyricEnhancement.modelTitle") }}
          <STag>Beta</STag>
        </div>
        <div class="mt-0.5 text-sm text-on-surface-variant/70">
          {{
            activeModel
              ? `${activeModel.name} · ${activeModel.model}`
              : t("settings.lyricEnhancement.noModel")
          }}
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <SButton variant="secondary" size="small" @click="configOpen = true">
          {{ t("settings.lyricEnhancement.configureModel") }}
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

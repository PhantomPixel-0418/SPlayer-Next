<script lang="ts">
const hdCache = shallowRef<{ id: string; data: string } | null>(null);
</script>

<script setup lang="ts">
import { getDynamicCover } from "@/apis/song/netease";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { useUserStore } from "@/stores/user";
import { useTimeoutFn } from "@vueuse/core";
import { nextTick } from "vue";

const media = useMediaStore();
const status = useStatusStore();
const settings = useSettingsStore();
const user = useUserStore();

/** 加载中的歌曲使用队列当前项作为封面兜底 */
const displayTrack = computed(() => media.track ?? status.currentTrack);

const coverSrc = computed(() =>
  hdCache.value && hdCache.value.id === displayTrack.value?.id
    ? hdCache.value.data
    : displayTrack.value?.coverOriginal || displayTrack.value?.cover,
);

watchEffect(async () => {
  const id = displayTrack.value?.id;
  if (!status.isPlayerExpanded || status.trackLoading || !id) return;
  if (displayTrack.value?.source !== "local" || hdCache.value?.id === id) return;
  const r = await window.api.player.getCoverRaw();
  if (displayTrack.value?.id !== id || !r.success || !r.data) return;
  hdCache.value = { id, data: r.data };
});

/** 动态封面地址与加载状态 */
const dynamicCoverUrl = ref<string>("");
const dynamicCoverLoaded = ref<boolean>(false);
const videoRef = ref<HTMLVideoElement | null>(null);

/** 动态封面在经典与全屏封面布局展示 */
const isCoverMode = computed(
  () => settings.player.layout === "classic" || settings.player.layout === "fullCover",
);

/** 是否在加载中 */
const trackLoading = computed(() => status.trackLoading);

/**
 * 获取动态封面
 * 仅对网易云来源、封面类布局、已登录且开关开启的歌曲生效
 */
const fetchDynamicCover = async (): Promise<void> => {
  const track = displayTrack.value;
  if (!track) {
    dynamicCoverUrl.value = "";
    return;
  }
  if (
    track.source !== "netease" ||
    !isCoverMode.value ||
    !user.isLoggedIn ||
    !settings.player.dynamicCover ||
    trackLoading.value
  ) {
    dynamicCoverUrl.value = "";
    return;
  }

  dynamicCoverStop();
  dynamicCoverLoaded.value = false;

  const url = await getDynamicCover(track.id);
  if (displayTrack.value?.id !== track.id) return;
  dynamicCoverUrl.value = url ?? "";
};

/** 封面再放送：视频结束后 2s 重新播放 */
const { start: dynamicCoverStart, stop: dynamicCoverStop } = useTimeoutFn(
  () => {
    dynamicCoverLoaded.value = true;
    nextTick(() => {
      videoRef.value?.play();
    });
  },
  2000,
  { immediate: false },
);

const onDynamicCoverEnded = (): void => {
  dynamicCoverLoaded.value = false;
  dynamicCoverStart();
};

const cleanupDynamicCover = (): void => {
  if (videoRef.value) {
    videoRef.value.pause();
    videoRef.value.src = "";
    videoRef.value.load();
  }
  dynamicCoverUrl.value = "";
  dynamicCoverLoaded.value = false;
};

watch(
  () =>
    [
      displayTrack.value?.id,
      settings.player.dynamicCover,
      settings.player.layout,
      status.trackLoading,
    ] as const,
  () => {
    fetchDynamicCover();
  },
);

onMounted(() => {
  fetchDynamicCover();
});

onBeforeUnmount(() => {
  dynamicCoverStop();
  cleanupDynamicCover();
});
</script>

<template>
  <!-- 外观由布局决定，这里只负责高清封面加载、动态封面与共享过渡标记 -->
  <div data-player-cover="full" class="relative overflow-hidden shrink-0">
    <DetailCover :src="coverSrc" :fallback="displayTrack?.cover" class="size-full" />
    <!-- 动态封面 -->
    <Transition name="fade" mode="out-in">
      <video
        v-if="dynamicCoverUrl"
        ref="videoRef"
        :src="dynamicCoverUrl"
        :class="['dynamic-cover', { loaded: dynamicCoverLoaded }]"
        muted
        autoplay
        playsinline
        @loadeddata="dynamicCoverLoaded = true"
        @ended="onDynamicCoverEnded"
      />
    </Transition>
  </div>
</template>

<style scoped>
.dynamic-cover {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
  overflow: hidden;
  z-index: 1;
  opacity: 0;
  transition: opacity 0.8s ease-in-out;
  backface-visibility: hidden;
  transform: translateZ(0);

  &.loaded {
    opacity: 1;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

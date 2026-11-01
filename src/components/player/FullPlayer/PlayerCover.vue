<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";

type PlayerCoverProps = {
  fullscreen?: boolean;
  /** 全屏封面的渐隐方式：right 右侧衔接歌词，both 两侧居中 */
  fadeMode?: "right" | "both";
};

withDefaults(defineProps<PlayerCoverProps>(), {
  fullscreen: false,
  fadeMode: "right",
});

const media = useMediaStore();
const status = useStatusStore();
const { isPlaying } = storeToRefs(status);

/** 加载中的歌曲使用队列当前项作为封面兜底 */
const displayTrack = computed(() => media.track ?? status.currentTrack);

/** 高清封面缓存条目 */
type CoverCache = {
  id: string;
  data: string;
};

/** 高清封面缓存 */
const hdCache = shallowRef<CoverCache | null>(null);

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
</script>

<template>
  <div
    data-player-cover="full"
    :class="
      fullscreen
        ? [
            'w-full h-full aspect-auto rounded-none bg-transparent overflow-hidden shrink-0',
            fadeMode === 'both' ? 'player-cover-fade-both' : 'player-cover-fade-right',
          ]
        : [
            'player-cover',
            'w-full aspect-square rounded-[32px] overflow-hidden shrink-0',
            'shadow-[0_0_20px_10px_rgba(0,0,0,0.1)]',
            isPlaying ? 'scale-100' : 'scale-90',
          ]
    "
  >
    <DetailCover :src="coverSrc" :fallback="displayTrack?.cover" class="size-full" />
  </div>
</template>

<style scoped>
.player-cover {
  transition:
    transform 500ms cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 200ms ease-out;
}

/* 右侧渐隐：封面与歌词并排时向歌词侧衔接 */
.player-cover-fade-right {
  mask-image: linear-gradient(
    to right,
    rgba(0, 0, 0, 1) 0%,
    rgba(0, 0, 0, 0.98) 10%,
    rgba(0, 0, 0, 0.92) 22%,
    rgba(0, 0, 0, 0.82) 32%,
    rgba(0, 0, 0, 0.68) 42%,
    rgba(0, 0, 0, 0.52) 52%,
    rgba(0, 0, 0, 0.36) 62%,
    rgba(0, 0, 0, 0.22) 72%,
    rgba(0, 0, 0, 0.1) 82%,
    rgba(0, 0, 0, 0.03) 92%,
    rgba(0, 0, 0, 0) 100%
  );
}

/* 两侧对称渐隐：纯封面时画面聚焦中央，与左右背景衔接 */
.player-cover-fade-both {
  mask-image: linear-gradient(
    to right,
    rgba(0, 0, 0, 0) 0%,
    rgba(0, 0, 0, 0.5) 16%,
    rgba(0, 0, 0, 1) 34%,
    rgba(0, 0, 0, 1) 66%,
    rgba(0, 0, 0, 0.5) 84%,
    rgba(0, 0, 0, 0) 100%
  );
}
</style>

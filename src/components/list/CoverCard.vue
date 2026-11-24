<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import artistFallback from "@/assets/images/artist.jpg";
import { captureCover } from "@/services/coverTransition";
import { formatCompact } from "@/utils/format";
import { formatTime } from "@/utils/time";

export interface CoverCardProps {
  /** 卡片数据 */
  item: CoverItem;
  /** 类型：default / artist / video */
  type?: "default" | "artist" | "video";
  /** 封面圆角 class */
  rounded?: string;
  /** 封面占位图 */
  fallback?: string;
}

const props = withDefaults(defineProps<CoverCardProps>(), {
  type: "default",
  rounded: "rounded-xl",
});

const emit = defineEmits<{ click: [] }>();
const { locale } = useI18n();
/** 稳定的封面标识：页面重新挂载后仍能匹配，不能用组件实例 ID */
const coverKey = computed(() => `${props.type}:${props.item.id}`);

/** 记录封面后分发点击，由实际目标路由决定是否启用共享过渡 */
const handleClick = (): void => {
  captureCover(props.item, coverKey.value);
  emit("click");
};

const coverRounded = computed(() => (props.type === "artist" ? "rounded-full" : props.rounded));
const coverAspect = computed(() => (props.type === "video" ? "aspect-video" : "aspect-square"));
const actualFallback = computed(() => (props.type === "artist" ? artistFallback : props.fallback));
/** 视频播放量 */
const playCountText = computed(() =>
  props.type === "video" ? formatCompact(props.item.playCount, locale.value) : "",
);
/** 视频时长 */
const durationText = computed(() =>
  props.type === "video" && props.item.duration ? formatTime(props.item.duration) : "",
);
</script>

<template>
  <div
    class="cursor-pointer group rounded-xl transition-colors duration-300"
    :class="type !== 'artist' ? 'hover:bg-primary/10' : ''"
    @click="handleClick"
  >
    <!-- 封面 -->
    <div class="relative overflow-hidden group-hover:will-change-transform" :class="coverRounded">
      <SImg
        :data-cover-key="coverKey"
        :src="item.cover"
        :fallback="actualFallback"
        :alt="item.title"
        class="cover-card-image w-full transition-[transform,filter] duration-300 ease-out group-hover:scale-108 group-hover:brightness-80"
        :class="[coverRounded, coverAspect]"
      />
      <!-- 视频统计 -->
      <div
        v-if="type === 'video'"
        class="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-6 text-[11px] font-medium text-white"
      >
        <span v-if="playCountText" class="flex items-center gap-1">
          <IconLucidePlay class="size-3" />
          {{ playCountText }}
        </span>
        <span v-else />
        <span v-if="durationText">{{ durationText }}</span>
      </div>
      <!-- 播放按钮 -->
      <div
        data-cover-action
        class="absolute size-9 flex items-center justify-center rounded-full opacity-0 transition-[opacity,transform] duration-300 group-hover:opacity-100"
        :class="
          type === 'artist'
            ? 'inset-0 m-auto'
            : type === 'video'
              ? 'inset-0 m-auto bg-white/50 scale-90 group-hover:scale-100'
              : 'right-2 bottom-2 bg-white/50 translate-y-1.5 group-hover:translate-y-0'
        "
      >
        <IconLucidePlay v-if="type !== 'artist'" class="size-4.5 text-white" />
        <IconLucideUser v-else class="size-8 text-white" />
      </div>
    </div>
    <!-- 信息 -->
    <div
      class="flex flex-col gap-0.5 px-2.5 py-2.5"
      :class="type === 'artist' ? 'items-center' : ''"
    >
      <div
        class="text-sm text-on-surface line-clamp-2 leading-snug text-pretty"
        :class="type === 'artist' ? 'text-center w-full' : ''"
      >
        {{ item.title }}
      </div>
      <div
        v-if="item.subtitle"
        class="text-xs text-on-surface-variant/50 truncate"
        :class="type === 'artist' ? 'text-center w-full' : ''"
      >
        {{ item.subtitle }}
      </div>
    </div>
  </div>
</template>

<style scoped>
[data-cover-shared] {
  transform: none !important;
  filter: none !important;
  transition: none !important;
}

[data-cover-shared] ~ [data-cover-action] {
  opacity: 0 !important;
  transition: none !important;
}
</style>

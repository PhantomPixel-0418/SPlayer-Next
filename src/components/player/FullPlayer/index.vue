<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { usePlaybackTime } from "@/composables/usePlaybackTime";
import { getCurrentTime } from "@/services/playback";
import type { QualityLevel } from "@/utils/quality";
import { useFavorite } from "@/composables/useFavorite";
import { useDownload, buildDownloadQualityItems } from "@/composables/useDownload";
import { usePlaylistPicker } from "@/composables/usePlaylistPicker";
import { useImmersiveMode } from "@/composables/useImmersiveMode";
import { useTimeFormat } from "@/composables/useTimeFormat";
import { useProgressLyric } from "@/composables/useProgressLyric";
import Lyrics from "@/components/player/Lyrics/index.vue";
import { useWindowControls } from "@/composables/useWindowControls";
import * as player from "@/core/player";
import { playerTransitionActive, setPlayerExpanded } from "@/services/playerTransition";
import { shouldUpdateFrame, type FrameRateGate } from "@/utils/lyric/frameRateGate";
import {
  isFullscreenCoverExpanded,
  shouldCenterCover,
  shouldTreatLyricsAsReady,
} from "./displayState";
import { captureTrackInfoHeight, resetTrackInfoHeight } from "./trackInfoTransition";

const status = useStatusStore();
const media = useMediaStore();
const settings = useSettingsStore();
const fav = useFavorite();
const { enqueue: enqueueDownload } = useDownload();
const { t } = useI18n();
const {
  isPlaying,
  isLoading,
  position,
  duration,
  isPlayerExpanded,
  repeatMode,
  shuffleMode,
  heartMode,
  fmMode,
  showLyric,
  showCover,
} = storeToRefs(status);

const { timeDisplay, toggleTimeFormat } = useTimeFormat();
const { snapToNearestLyric } = useProgressLyric();

const lyricRef = ref<InstanceType<typeof Lyrics>>();
const lyricMounted = ref(false);
const lyricReady = ref(false);
const lyricEngineReady = ref(false);
const playerVisible = ref(false);
const visualizerMounted = ref(false);
const initialLyricTimeMs = ref(0);
let visualizerIdle = 0;
let lyricFrameLimitTimeout: ReturnType<typeof setTimeout> | undefined;
const LYRIC_LAYOUT_TRANSITION_MS = 250;
const AMLL_TRANSITION_FPS_LIMIT = 24;
/** 常规歌词渲染帧率，布局过渡结束后恢复到此值 */
const AMLL_NORMAL_FPS = 60;
const lyricFrameRateLimit = ref(AMLL_NORMAL_FPS);
let enterPrepared = false;
const lyricTimePushGate: FrameRateGate = {};
const visibility = useDocumentVisibility();

/** 布局过渡期间临时限制 AMLL 更新频率，结束后恢复常规帧率 */
const limitLyricFramesDuringTransition = (): void => {
  if (lyricFrameLimitTimeout) clearTimeout(lyricFrameLimitTimeout);
  lyricFrameRateLimit.value = AMLL_TRANSITION_FPS_LIMIT;
  lyricFrameLimitTimeout = setTimeout(() => {
    lyricFrameRateLimit.value = AMLL_NORMAL_FPS;
    lyricFrameLimitTimeout = undefined;
  }, LYRIC_LAYOUT_TRANSITION_MS);
};

/** 加载中的歌曲使用队列当前项兜底，避免全屏播放器出现空白 */
const displayTrack = computed(() => media.track ?? status.currentTrack);
const hasLyric = computed(() => media.parsedLyric.length > 0 || media.lyricLoading);
const hasTrack = computed(() => !!displayTrack.value);

/** 精确播放时间（毫秒） */
const { start: startTick, stop: stopTick } = usePlaybackTime((currentMs) => {
  if (status.trackLoading || media.lyricLoading || !showLyric.value) return;

  const isSeeking = player.isSeeking();
  const frameRateLimit = settings.lyric.engine === "amll" ? lyricFrameRateLimit.value : undefined;
  if (frameRateLimit) {
    if (!shouldUpdateFrame(performance.now(), lyricTimePushGate, frameRateLimit, isSeeking)) return;
  } else {
    lyricTimePushGate.nextUpdateAt = undefined;
  }

  lyricRef.value?.setCurrentTime(currentMs + status.lyricOffsetMs, isSeeking);
});

/** 歌词首帧就绪后在空闲时段创建可视化，避免布局测量与 WebGL 初始化争抢一帧 */
const scheduleVisualizers = (): void => {
  if (
    visualizerIdle ||
    visualizerMounted.value ||
    playerTransitionActive.value ||
    !isPlayerExpanded.value ||
    visibility.value !== "visible"
  ) {
    return;
  }
  visualizerIdle = requestIdleCallback(
    () => {
      visualizerIdle = 0;
      if (
        isPlayerExpanded.value &&
        !playerTransitionActive.value &&
        visibility.value === "visible"
      ) {
        visualizerMounted.value = true;
      }
    },
    { timeout: 500 },
  );
};

/** 标记当前歌词布局已就绪并安排可视化初始化 */
const markLyricReady = (): void => {
  lyricReady.value = true;
  scheduleVisualizers();
};

/** 歌词完成首次布局后安排可视化初始化 */
const onLyricReady = (): void => {
  if (!isPlayerExpanded.value) return;
  lyricEngineReady.value = true;
  markLyricReady();
};

/** 恢复显示中的歌词并校准播放位置 */
const resumeLyricDisplay = (): void => {
  lyricRef.value?.setCurrentTime(getCurrentTime() + status.lyricOffsetMs);
  lyricRef.value?.resume();
};

/** 隐藏歌词时冻结歌词引擎，避免后台持续渲染 */
const freezeLyricDisplay = (): void => {
  lyricRef.value?.freeze();
};

watch(visibility, (value) => {
  if (value === "visible" && lyricReady.value) scheduleVisualizers();
});

/** 每次展开只初始化一次歌词，复用已挂载内容处理快速收起再展开 */
const preparePlayerContent = (): void => {
  if (enterPrepared) return;
  enterPrepared = true;
  initialLyricTimeMs.value = getCurrentTime() + status.lyricOffsetMs;
  lyricMounted.value = true;
  nextTick(() => {
    if (!isPlayerExpanded.value) return;
    lyricRef.value?.setCurrentTime(getCurrentTime() + status.lyricOffsetMs);
    lyricRef.value?.resume();
    startTick();
    if (lyricReady.value) scheduleVisualizers();
    else if (shouldTreatLyricsAsReady(showLyric.value, hasLyric.value)) markLyricReady();
  });
};

/** 展开前仅显示静态背景与封面 */
const onBeforeEnter = (): void => {
  playerVisible.value = true;
  enterPrepared = false;
};

/** 普通过渡完成后准备内容，共享过渡由快照结束驱动 */
const onAfterEnter = (): void => {
  if (!isPlayerExpanded.value || playerTransitionActive.value) return;
  preparePlayerContent();
};

watch(
  playerTransitionActive,
  (active, previous, onCleanup) => {
    if (active || !previous || !isPlayerExpanded.value) return;
    // 动画结束后再加载歌词引擎，避免解析抢占动画帧
    const idle = requestIdleCallback(
      () => {
        if (!playerTransitionActive.value && isPlayerExpanded.value) preparePlayerContent();
      },
      { timeout: 300 },
    );
    onCleanup(() => cancelIdleCallback(idle));
  },
  { immediate: true },
);

/** 收起前取消可视化初始化并冻结歌词 */
const onBeforeLeave = () => {
  cancelIdleCallback(visualizerIdle);
  visualizerIdle = 0;
  lyricRef.value?.freeze();
  stopTick();
};

/** 收起结束后卸载歌词与可视化 */
const onAfterLeave = () => {
  playerVisible.value = false;
  lyricMounted.value = false;
  lyricReady.value = false;
  lyricEngineReady.value = false;
  visualizerMounted.value = false;
};

onBeforeUnmount(() => {
  cancelIdleCallback(visualizerIdle);
  if (lyricFrameLimitTimeout) clearTimeout(lyricFrameLimitTimeout);
});

// 重新挂载时，刷新初始时间；加载结束仍无歌词时歌词组件会卸载，按就绪处理
watch(hasLyric, (value) => {
  if (!lyricMounted.value) return;
  if (value) {
    initialLyricTimeMs.value = getCurrentTime() + status.lyricOffsetMs;
    return;
  }
  lyricEngineReady.value = false;
  if (isPlayerExpanded.value) markLyricReady();
});

watch(showLyric, (visible) => {
  if (!visible || !lyricMounted.value) return;
  initialLyricTimeMs.value = getCurrentTime() + status.lyricOffsetMs;
});

// 歌词变化时先推送精确时间
watch(
  () => media.parsedLyric,
  () => lyricRef.value?.setCurrentTime(getCurrentTime() + status.lyricOffsetMs),
);

// 切换歌词引擎时，重新计算初始并推送时间
watch(
  () => settings.lyric.engine,
  () => {
    initialLyricTimeMs.value = getCurrentTime() + status.lyricOffsetMs;
    nextTick(() => {
      lyricRef.value?.setCurrentTime(getCurrentTime() + status.lyricOffsetMs);
      if (isPlaying.value) lyricRef.value?.resume();
    });
  },
);

const fullscreenCover = computed(() => settings.player.coverLayout === "fullscreen");
const coverWidth = computed(() => `${settings.player.coverLyricRatio * 100}%`);
/** 歌词区面板：显示歌词时，或全屏纯封面（保留标题栏）时可见 */
const lyricPanelVisible = computed(() => showLyric.value || coverExpanded.value);

/** 全屏布局下纯封面（隐藏歌词）时封面居中、两侧对称渐隐；与歌词并排时保持左侧 60% 右侧渐隐 */
const coverExpanded = computed(() =>
  isFullscreenCoverExpanded(fullscreenCover.value, showCover.value, showLyric.value),
);

/** 歌词侧边工具栏：面板可见且非全屏纯封面（保留标题栏）态时显示 */
const lyricToolbarVisible = computed(() => lyricPanelVisible.value && !coverExpanded.value);

const coverCentered = computed(() => {
  return shouldCenterCover(
    fullscreenCover.value,
    status.fullQueueOpen,
    showLyric.value,
    settings.player.autoCenterCover,
    hasLyric.value,
    showCover.value,
  );
});

const handleLyricSeek = async (timeMs: number): Promise<void> => {
  await player.seek(timeMs);
  if (!isPlaying.value) await player.play();
};

const lyricFontSize = computed(() =>
  settings.lyric.adaptiveFontSize
    ? `calc(${settings.lyric.fontSize} / 1080 * 100vh)`
    : `${settings.lyric.fontSize}px`,
);

const lyricSubFontSize = computed(() => {
  if (settings.lyric.translationFontSizeFollowMain) return "max(0.5em, 12px)";
  return settings.lyric.adaptiveFontSize
    ? `max(12px, calc(${settings.lyric.translationFontSize} / 1080 * 100vh))`
    : `${settings.lyric.translationFontSize}px`;
});

const { immersive, onPlayerMouseEnter, onPlayerMouseLeave, onMainMove, onBarEnter, onBarLeave } =
  useImmersiveMode(isPlayerExpanded);

const { isFullscreen, toggleFullscreen } = useWindowControls();

const canDownload = computed(
  () =>
    !!displayTrack.value &&
    displayTrack.value.source !== "local" &&
    displayTrack.value.source !== "plugin" &&
    settings.system.download.enabled,
);

const downloadQualityItems = computed(() =>
  buildDownloadQualityItems(t("download.qualityDefault")),
);

const onDownloadSelect = (key: string): void => {
  if (!displayTrack.value) return;
  void enqueueDownload(displayTrack.value, key ? { quality: key as QualityLevel } : {});
};

const onSeekDragEnd = (value: number): void => {
  player.seek(snapToNearestLyric(value));
};

const {
  open: pickerOpen,
  tracks: pickerTracks,
  mode: pickerMode,
  openPicker,
} = usePlaylistPicker();

const lyricToggleActive = computed(
  () => (showLyric.value || !showCover.value) && !status.fullQueueOpen,
);

/** 按封面与歌词的三种显示状态循环切换 */
const toggleLyric = (): void => {
  if (status.fullQueueOpen) {
    status.fullQueueOpen = false;
    limitLyricFramesDuringTransition();
    showLyric.value = true;
    showCover.value = true;
    return;
  }
  if (!showCover.value) {
    limitLyricFramesDuringTransition();
    showCover.value = true;
    showLyric.value = true;
  } else if (showLyric.value) {
    limitLyricFramesDuringTransition();
    showLyric.value = false;
  } else {
    limitLyricFramesDuringTransition();
    showCover.value = false;
    showLyric.value = true;
  }
};

const showComments = (): void => {
  if (displayTrack.value) status.showComments(displayTrack.value);
};
</script>

<template>
  <Teleport to="body">
    <Transition
      appear
      :css="!playerTransitionActive"
      enter-active-class="transition-transform duration-500 ease-[cubic-bezier(0.7,0,0.3,1)]"
      leave-active-class="transition-transform duration-500 ease-[cubic-bezier(0.7,0,0.3,1)]"
      enter-from-class="translate-y-full"
      leave-to-class="translate-y-full"
      @after-enter="onAfterEnter"
      @before-enter="onBeforeEnter"
      @before-leave="onBeforeLeave"
      @after-leave="onAfterLeave"
    >
      <div
        v-show="isPlayerExpanded"
        class="player-panel fixed inset-0 z-200 overflow-hidden text-cover"
        :class="immersive ? 'cursor-none [&_*]:!cursor-none' : ''"
        style="--lp-color: rgb(var(--s-cover))"
        @mouseenter="onPlayerMouseEnter"
        @mouseleave="onPlayerMouseLeave"
      >
        <!-- 背景 -->
        <PlayerBackground :visible="playerVisible" :active="visualizerMounted" />
        <!-- 全屏封面 -->
        <Transition
          enter-active-class="transition-opacity duration-250 ease-linear"
          enter-from-class="opacity-0"
          leave-active-class="transition-opacity duration-250 ease-linear"
          leave-to-class="opacity-0"
        >
          <div
            v-if="fullscreenCover && showCover"
            class="absolute inset-y-0 transition-[left,width] duration-250 ease-linear"
            :style="{
              left: coverExpanded ? '48px' : '0',
              width: coverExpanded ? 'calc(100% - 96px)' : '60%',
            }"
          >
            <PlayerCover fullscreen :fade-mode="coverExpanded ? 'both' : 'right'" />
          </div>
        </Transition>
        <!-- 底部频谱 -->
        <BottomSpectrum
          v-if="isPlayerExpanded && visualizerMounted && settings.player.enableSpectrum"
          :show="isPlaying && immersive"
        />
        <!-- 顶/底栏渐变遮罩（全屏封面模式） -->
        <Transition
          enter-active-class="transition-opacity duration-250 ease-linear"
          enter-from-class="opacity-0"
          leave-active-class="transition-opacity duration-250 ease-linear"
          leave-to-class="opacity-0"
        >
          <div
            v-if="fullscreenCover && showCover"
            class="absolute top-0 inset-x-0 h-20 z-5 pointer-events-none"
          >
            <div
              class="cover-mask-top absolute inset-0 transition-opacity duration-400"
              :class="immersive ? 'opacity-0' : 'opacity-100'"
            />
          </div>
        </Transition>
        <Transition
          enter-active-class="transition-opacity duration-250 ease-linear"
          enter-from-class="opacity-0"
          leave-active-class="transition-opacity duration-250 ease-linear"
          leave-to-class="opacity-0"
        >
          <div
            v-if="fullscreenCover && showCover"
            class="absolute bottom-0 inset-x-0 h-48 z-5 pointer-events-none"
          >
            <div
              class="cover-mask-bottom absolute inset-0 transition-opacity duration-400"
              :class="immersive ? 'opacity-0' : 'opacity-100'"
            />
          </div>
        </Transition>
        <!-- 顶栏 -->
        <div
          class="absolute top-0 inset-x-0 h-14 z-10 app-drag-region transition-opacity duration-400 flex items-center justify-between px-3"
          :class="immersive ? 'opacity-0 pointer-events-none' : 'opacity-100'"
          @mouseenter="onBarEnter"
          @mouseleave="onBarLeave"
        >
          <div class="app-no-drag flex items-center gap-2">
            <SButton
              type="cover"
              variant="ghost"
              circle
              :size="40"
              :class="lyricToggleActive ? 'opacity-100' : 'opacity-40'"
              @click="toggleLyric"
            >
              <template #icon><IconLucideTextQuote /></template>
            </SButton>
          </div>
          <div class="app-no-drag flex items-center gap-3">
            <SButton type="cover" variant="ghost" circle :size="40" @click="toggleFullscreen">
              <template #icon>
                <IconLucideMinimize v-if="isFullscreen" />
                <IconLucideMaximize v-else />
              </template>
            </SButton>
            <WindowControls cover />
          </div>
        </div>
        <!-- 主区域 -->
        <div class="absolute top-14 inset-x-0 bottom-20" @mousemove="onMainMove">
          <!-- 左侧 -->
          <Transition
            enter-active-class="transition-opacity duration-250 ease-linear"
            enter-from-class="opacity-0"
            leave-active-class="transition-opacity duration-250 ease-linear"
            leave-to-class="opacity-0"
          >
            <div
              v-if="!fullscreenCover && showCover"
              class="absolute inset-y-0 left-0 flex items-center justify-center pl-20 pr-12 transition-[width,opacity,transform] duration-250 ease-linear"
              :style="{
                width: coverWidth,
                transform: coverCentered ? 'translateX(calc(50vw - 50%))' : undefined,
              }"
            >
              <div class="relative w-[clamp(200px,85%,50vh)] -translate-y-[11vh]">
                <Transition name="scale-switch" mode="out-in">
                  <div :key="displayTrack?.id">
                    <PlayerCover />
                    <div class="absolute top-full left-0 w-full pt-6">
                      <PlayerData align="left" />
                    </div>
                  </div>
                </Transition>
              </div>
            </div>
          </Transition>
          <!-- 右侧 -->
          <div
            class="group absolute inset-y-0 right-0 flex flex-col z-20 transition-[width,padding,opacity] duration-250 ease-linear"
            :class="[
              coverExpanded ? 'pr-0' : 'pr-20',
              !showCover ? 'pl-20' : '',
              !lyricPanelVisible || coverCentered || status.fullQueueOpen
                ? 'opacity-0 pointer-events-none'
                : 'opacity-100',
            ]"
            :style="{
              width:
                !showCover || coverExpanded
                  ? '100%'
                  : fullscreenCover
                    ? '50%'
                    : `calc(100% - ${coverWidth})`,
            }"
            :inert="!lyricPanelVisible || coverCentered || status.fullQueueOpen"
          >
            <div class="flex flex-col flex-1 min-h-0 min-w-0">
              <!-- 全屏封面 -->
              <Transition
                name="lyric-track-info"
                enter-to-class="lyric-track-info-enter-to"
                leave-from-class="lyric-track-info-leave-from"
                @after-enter="resetTrackInfoHeight"
                @before-leave="captureTrackInfoHeight"
              >
                <div
                  v-if="fullscreenCover || !showCover"
                  class="lyric-track-info shrink-0 pt-2 pb-6"
                  :class="
                    coverExpanded
                      ? 'text-center'
                      : showCover
                        ? 'pl-[calc(1em-0.5rem)]'
                        : 'text-center'
                  "
                  :style="{ fontSize: lyricFontSize }"
                >
                  <PlayerData
                    :align="coverExpanded ? 'center' : showCover ? 'left' : 'center'"
                    simple
                  />
                </div>
              </Transition>
              <!-- 歌词容器 -->
              <Transition
                enter-active-class="lyric-area-transition-active"
                enter-from-class="lyric-area-transition-from"
                leave-active-class="lyric-area-transition-active"
                leave-to-class="lyric-area-transition-from"
                @after-enter="resumeLyricDisplay"
                @before-leave="freezeLyricDisplay"
              >
                <div
                  v-show="showLyric"
                  class="lyric-area relative min-h-0"
                  :style="{
                    '--lp-credit-opacity': '1',
                    fontSize: lyricFontSize,
                    '--lp-sub-font-size': lyricSubFontSize,
                    fontWeight: String(settings.lyric.fontWeight),
                    fontFamily: settings.lyric.fontFamily || undefined,
                    '--lyric-font-zh': settings.lyric.fontFamilyChinese || undefined,
                    '--lyric-font-ja': settings.lyric.fontFamilyJapanese || undefined,
                    '--lyric-font-ko': settings.lyric.fontFamilyKorean || undefined,
                    '--lyric-font-latin': settings.lyric.fontFamilyLatin || undefined,
                    mixBlendMode: settings.lyric.lyricBlendMode,
                  }"
                >
                  <Lyrics
                    v-if="lyricMounted && hasLyric && (showLyric || lyricEngineReady)"
                    ref="lyricRef"
                    :lyric-lines="media.parsedLyric"
                    :initial-time="initialLyricTimeMs"
                    :playing="isPlaying"
                    :frame-rate-limit="lyricFrameRateLimit"
                    @seek="handleLyricSeek"
                    @ready="onLyricReady"
                  />
                  <div
                    v-else-if="lyricMounted"
                    class="w-full h-full flex items-center justify-center text-cover/30"
                  >
                    暂无歌词
                  </div>
                </div>
              </Transition>
            </div>
            <!-- 歌词侧边工具栏 -->
            <LyricActions v-if="lyricToolbarVisible" :immersive="immersive" />
          </div>
          <!-- 播放队列 -->
          <div
            class="absolute inset-y-0 right-0 py-6 flex items-center transition-[width,padding] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
            :class="[
              !showCover ? 'pl-20' : 'pl-4',
              status.fullQueueOpen ? '' : 'pointer-events-none',
            ]"
            :style="{
              width: !showCover ? '100%' : fullscreenCover ? '50%' : `calc(100% - ${coverWidth})`,
            }"
          >
            <Transition
              enter-active-class="transition-opacity duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
              enter-from-class="opacity-0"
              leave-active-class="transition-opacity duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
              leave-to-class="opacity-0"
            >
              <div v-if="status.fullQueueOpen" class="w-full h-full">
                <QueuePanel @close="status.fullQueueOpen = false" />
              </div>
            </Transition>
          </div>
        </div>
        <!-- 底栏 -->
        <div
          class="absolute bottom-0 inset-x-0 h-20 z-10 flex items-center gap-4 px-4 transition-opacity duration-400"
          :class="immersive ? 'opacity-0 pointer-events-none' : 'opacity-100'"
          @mouseenter="onBarEnter"
          @mouseleave="onBarLeave"
        >
          <div class="flex-1 min-w-0 flex items-center justify-start gap-2">
            <SButton
              type="cover"
              variant="ghost"
              size="large"
              circle
              @click="setPlayerExpanded(false)"
            >
              <template #icon><IconLucideChevronDown /></template>
            </SButton>
            <SButton
              v-if="displayTrack?.source !== 'plugin'"
              type="cover"
              variant="ghost"
              size="large"
              circle
              :disabled="!hasTrack || !fav.isSupported(displayTrack)"
              @click="fav.toggle(displayTrack)"
            >
              <template #icon>
                <SIconSwap :active="fav.isLiked(displayTrack)">
                  <template #on><IconMaterialSymbolsFavoriteRounded /></template>
                  <template #off><IconMaterialSymbolsFavoriteOutlineRounded /></template>
                </SIconSwap>
              </template>
            </SButton>
            <SButton
              type="cover"
              variant="ghost"
              size="large"
              circle
              :disabled="!hasTrack"
              @click="showComments"
            >
              <template #icon><IconLucideMessageCircle /></template>
            </SButton>
            <SButton
              v-if="displayTrack?.source === 'local' || displayTrack?.source === 'netease'"
              type="cover"
              variant="ghost"
              size="large"
              circle
              @click="displayTrack && openPicker([displayTrack])"
            >
              <template #icon><IconLucideListPlus /></template>
            </SButton>
            <SDropdownMenu
              v-if="canDownload"
              :items="downloadQualityItems"
              cover
              side="top"
              align="start"
              @select="onDownloadSelect"
            >
              <template #trigger>
                <SButton type="cover" variant="ghost" size="large" circle>
                  <template #icon><IconLucideDownload /></template>
                </SButton>
              </template>
            </SDropdownMenu>
          </div>
          <div class="shrink-0 flex flex-col items-center gap-1 w-[clamp(360px,35%,480px)]">
            <div class="flex items-center gap-3">
              <SButton
                type="cover"
                variant="ghost"
                circle
                @click="
                  fmMode
                    ? player.dislikeFmTrack()
                    : heartMode
                      ? player.exitHeartMode()
                      : player.toggleShuffleMode()
                "
              >
                <template #icon>
                  <IconLucideHeartOff v-if="fmMode" />
                  <IconSpHeartMode v-else-if="heartMode" />
                  <IconLucideShuffle v-else-if="shuffleMode === 'on'" />
                  <IconSpPlayOrder v-else />
                </template>
              </SButton>
              <SButton
                type="cover"
                variant="ghost"
                circle
                :disabled="!hasTrack || fmMode"
                @click="player.prevTrack()"
              >
                <template #icon><IconLucideSkipBack /></template>
              </SButton>
              <SButton
                type="cover"
                variant="secondary"
                size="large"
                circle
                :loading="isLoading"
                :disabled="!hasTrack && !isLoading"
                @click="player.togglePlay()"
              >
                <template #icon>
                  <SIconSwap :active="isPlaying">
                    <template #on><IconLucidePause /></template>
                    <template #off><IconLucidePlay /></template>
                  </SIconSwap>
                </template>
              </SButton>
              <SButton
                type="cover"
                variant="ghost"
                circle
                :disabled="!hasTrack"
                @click="player.nextTrack()"
              >
                <template #icon><IconLucideSkipForward /></template>
              </SButton>
              <SButton
                type="cover"
                variant="ghost"
                circle
                :disabled="fmMode"
                :class="fmMode ? 'opacity-40' : 'opacity-100'"
                @click="player.cycleRepeatMode()"
              >
                <template #icon>
                  <IconLucideInfinity v-if="fmMode" />
                  <IconLucideRepeat1 v-else-if="repeatMode === 'one'" />
                  <IconLucideRepeat v-else />
                </template>
              </SButton>
            </div>
            <div class="flex items-center gap-2 w-full">
              <span
                class="text-xs text-cover/50 tabular-nums min-w-9 text-center cursor-pointer px-1.5 py-0.5 rounded-md transition-colors hover:bg-cover/10"
                @click="toggleTimeFormat"
              >
                {{ timeDisplay[0] }}
              </span>
              <SSlider
                :model-value="position"
                :glow="status.transitioning"
                :min="0"
                :max="duration"
                :step="100"
                :always-show-thumb="false"
                cover
                class="flex-1"
                @drag-end="onSeekDragEnd"
              />
              <span
                class="text-xs text-cover/50 tabular-nums min-w-9 text-center cursor-pointer px-1.5 py-0.5 rounded-md transition-colors hover:bg-cover/10"
                @click="toggleTimeFormat"
              >
                {{ timeDisplay[1] }}
              </span>
            </div>
          </div>
          <div class="flex-1 min-w-0 flex items-center justify-end">
            <Toolbar cover />
          </div>
        </div>
      </div>
    </Transition>
    <PlaylistPickerDialog v-model:open="pickerOpen" :mode="pickerMode" :tracks="pickerTracks" />
  </Teleport>
</template>

<style scoped>
.lyric-area {
  flex: 1 1 0%;
  filter: drop-shadow(0px 4px 6px rgba(0, 0, 0, 0.2));
  mask: linear-gradient(
    180deg,
    hsla(0, 0%, 100%, 0) 0,
    hsla(0, 0%, 100%, 0.6) 5%,
    #fff 10%,
    #fff 75%,
    hsla(0, 0%, 100%, 0.6) 85%,
    hsla(0, 0%, 100%, 0)
  );
}

.lyric-area-transition-active {
  transition:
    flex-grow 250ms linear,
    opacity 250ms linear;
}

.lyric-area-transition-from {
  flex: 0 1 0%;
  opacity: 0;
}

.lyric-track-info {
  overflow: clip;
}

.lyric-track-info-enter-active,
.lyric-track-info-leave-active {
  transition:
    max-height 250ms linear,
    padding 250ms linear,
    opacity 250ms linear,
    transform 250ms linear;
}

.lyric-track-info-enter-from {
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  opacity: 0;
  transform: translateX(-24px);
}

.lyric-track-info-enter-to {
  max-height: 500px;
}

.lyric-track-info-leave-from {
  max-height: var(--lyric-track-info-height, auto);
}

.lyric-track-info-leave-to {
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
  opacity: 0;
  transform: translateX(24px);
}

/* 顶部/底部遮罩：多段非线性 alpha，避免暗色渐变出色阶 */
.cover-mask-top {
  background-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.5) 0%,
    rgba(0, 0, 0, 0.44) 12%,
    rgba(0, 0, 0, 0.36) 25%,
    rgba(0, 0, 0, 0.27) 40%,
    rgba(0, 0, 0, 0.18) 55%,
    rgba(0, 0, 0, 0.1) 70%,
    rgba(0, 0, 0, 0.04) 85%,
    rgba(0, 0, 0, 0) 100%
  );
}

.cover-mask-bottom {
  background-image: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.5) 0%,
    rgba(0, 0, 0, 0.44) 12%,
    rgba(0, 0, 0, 0.36) 25%,
    rgba(0, 0, 0, 0.27) 40%,
    rgba(0, 0, 0, 0.18) 55%,
    rgba(0, 0, 0, 0.1) 70%,
    rgba(0, 0, 0, 0.04) 85%,
    rgba(0, 0, 0, 0) 100%
  );
}
</style>

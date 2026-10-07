<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import { getWordSweepProgress } from "lyric-kit";
import { getNowPlayingCurrentMs } from "@windows/shared/composables/useNowPlayingSync";

const props = withDefaults(
  defineProps<{
    line?: LyricLine;
    text?: string;
    wordByWord?: boolean;
    anchor?: "left" | "right";
  }>(),
  { wordByWord: false, anchor: "left" },
);

const useKaraoke = computed(() => props.wordByWord && !!props.line);
const plainText = computed(() => props.text ?? props.line?.words.map((w) => w.word).join("") ?? "");

const wrapperRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const overflowPx = ref(0);
/** 测量结果，供 RAF 渲染闭包读取（非响应式，避免每帧走 ref 代理） */
let containerWRef = 0;
let overflowPxRef = 0;
const isOverflow = computed(() => overflowPx.value > 0);

const wordRefs: (HTMLSpanElement | undefined)[] = [];
/** 逐词宽度缓存，行切换时清空 */
const wordWidthCache = new Map<LyricLine, number[]>();

let resizeObserver: ResizeObserver | null = null;
let rafId = 0;
let lastTransform = "";
let lastWordProgress: string[] = [];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 测量容器宽与溢出量
 * @returns 无返回，结果写入 containerWRef / overflowPxRef
 */
const measure = (): void => {
  const outer = wrapperRef.value;
  const inner = contentRef.value;
  if (!outer || !inner) {
    overflowPx.value = 0;
    containerWRef = 0;
    overflowPxRef = 0;
    return;
  }
  containerWRef = outer.getBoundingClientRect().width;
  const diff = inner.getBoundingClientRect().width - containerWRef;
  overflowPxRef = diff > 0.5 ? diff : 0;
  overflowPx.value = overflowPxRef;
};

/** 文本总宽度（含溢出部分） */
const getContentWidth = (): number => containerWRef + overflowPxRef;

/**
 * 读取已挂载的词 span 渲染宽度，按总宽等比对账后缓存
 * @returns 与 words 等宽的宽度数组，未就绪时返回空数组
 */
const buildWordWidths = (line: LyricLine): number[] => {
  const cached = wordWidthCache.get(line);
  if (cached) return cached;

  const words = line.words;
  const contentEl = contentRef.value;
  if (!contentEl || !words.length) return [];

  const widths: number[] = [];
  let total = 0;
  for (let i = 0; i < words.length; i++) {
    const el = wordRefs[i];
    const w = el ? Math.ceil(el.getBoundingClientRect().width) : 0;
    widths.push(w);
    total += w;
  }
  if (total <= 0) return [];

  const naturalWidth = Math.round(contentEl.getBoundingClientRect().width);
  const k = naturalWidth / total;
  let acc = 0;
  for (let i = 0; i < widths.length; i++) {
    const w = i < widths.length - 1 ? Math.round(widths[i] * k) : naturalWidth - acc;
    widths[i] = w;
    acc += w;
  }

  wordWidthCache.set(line, widths);
  return widths;
};

/** 按逐词时间定位进度像素位置，词间空隙停在词边界避免跳变 */
const getWordProgressX = (line: LyricLine, currentMs: number, widths: number[]): number => {
  const words = line.words;
  if (words.length === 0) return NaN;
  let prefix = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!Number.isFinite(word.startTime) || !Number.isFinite(word.endTime)) return NaN;
    if (currentMs < word.startTime) return prefix;
    if (currentMs < word.endTime) {
      const wordProgress = clamp01((currentMs - word.startTime) / (word.endTime - word.startTime));
      return prefix + wordProgress * widths[i];
    }
    prefix += widths[i];
  }
  return Math.min(prefix, getContentWidth());
};

/**
 * 计算当前进度在文本中的像素位置
 * 逐词时间轴可用时按词定位，否则按行线性插值
 * @returns 进度像素位置，时间数据不可用时返回 NaN
 */
const computeProgressX = (line: LyricLine, currentMs: number): number => {
  if (useKaraoke.value) {
    const widths = buildWordWidths(line);
    if (widths.length === line.words.length) {
      return getWordProgressX(line, currentMs, widths);
    }
    // 词宽缓存未就绪，降级到行级插值
    return (
      clamp01((currentMs - line.startTime) / Math.max(1, line.endTime - line.startTime)) *
      getContentWidth()
    );
  }
  const { startTime, endTime } = line;
  if (endTime <= startTime || !Number.isFinite(startTime) || !Number.isFinite(endTime)) return NaN;
  return clamp01((currentMs - startTime) / (endTime - startTime)) * getContentWidth();
};

/**
 * 计算横向滚动平移量
 * 溢出时进度点固定在容器中心，clamp 保证开头贴左边缘、结尾贴右边缘
 * @returns 应用到 scroll-content 的 transform 字符串
 */
const getScrollTransform = (currentMs: number): string => {
  if (overflowPxRef <= 0) return "translateX(0)";
  const line = props.line;
  if (!line || !line.words.length) {
    // 纯文本无时间轴，无进度可追踪
    return "translateX(0)";
  }
  const containerW = containerWRef;
  const textW = getContentWidth();
  const progressX = computeProgressX(line, currentMs);
  if (!Number.isFinite(progressX)) return lastTransform || "translateX(0)";
  const ideal = containerW / 2 - progressX;
  const clamped = Math.min(0, Math.max(containerW - textW, ideal));
  return `translateX(${clamped.toFixed(3)}px)`;
};

/** 逐词染色进度，驱动渐变色位置 */
const getWordProgress = (
  word: { startTime: number; endTime: number },
  lineStartTime: number,
  currentMs: number,
): string => {
  const progress = getWordSweepProgress(word, lineStartTime, currentMs);
  const pct = (progress * 100).toFixed(1);
  const px = progress * 4 - 2;
  const signed = px >= 0 ? `+ ${px.toFixed(2)}px` : `- ${(-px).toFixed(2)}px`;
  return `calc(${pct}% ${signed})`;
};

/**
 * v-for 的 ref 回调可能传入组件实例或 DOM 节点
 * @param el - 节点或组件实例
 * @param index - 词下标
 */
const setWordRef = (el: Element | { $el?: Element } | null, index: number): void => {
  const target = el instanceof Element ? el : (el?.$el ?? null);
  if (target instanceof HTMLSpanElement) {
    wordRefs[index] = target;
  } else {
    wordRefs[index] = undefined;
  }
};

const resetRenderCache = (): void => {
  lastTransform = "";
  lastWordProgress = [];
  wordRefs.length = 0;
};

/** 行切换后等布局稳定再测词宽，避免强制同步布局打断渲染帧 */
const scheduleWordWidthBuild = (): void => {
  nextTick(() => {
    requestAnimationFrame(() => {
      const line = props.line;
      if (line) buildWordWidths(line);
    });
  });
};

/** 更新滚动 transform */
const renderScroll = (currentMs: number): void => {
  if (!contentRef.value) return;
  const transform = getScrollTransform(currentMs);
  if (transform !== lastTransform) {
    lastTransform = transform;
    contentRef.value.style.transform = transform;
  }
};

/** 更新逐词染色 CSS 变量 */
const renderWordSweep = (currentMs: number): void => {
  if (!useKaraoke.value) return;
  const words = props.line!.words;
  const lineStartTime = props.line!.startTime;
  for (let i = 0; i < words.length; i++) {
    const el = wordRefs[i];
    if (!el) continue;
    const progress = getWordProgress(words[i], lineStartTime, currentMs);
    if (lastWordProgress[i] !== progress) {
      lastWordProgress[i] = progress;
      el.style.setProperty("--p", progress);
    }
  }
};

const renderFrame = (): void => {
  const currentMs = getNowPlayingCurrentMs();
  renderScroll(currentMs);
  renderWordSweep(currentMs);
  rafId = requestAnimationFrame(renderFrame);
};

watch(
  () => props.line,
  () => {
    resetRenderCache();
    wordWidthCache.clear();
    nextTick(measure);
    scheduleWordWidthBuild();
  },
);
watch(
  () => props.text,
  () => nextTick(measure),
);

onMounted(() => {
  resizeObserver = new ResizeObserver(measure);
  if (wrapperRef.value) resizeObserver.observe(wrapperRef.value);
  if (contentRef.value) resizeObserver.observe(contentRef.value);
  measure();
  rafId = requestAnimationFrame(renderFrame);
});

onBeforeUnmount(() => {
  if (rafId !== 0) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <div
    ref="wrapperRef"
    class="scroll-wrapper"
    :data-anchor="anchor"
    :class="{ 'is-overflow': isOverflow }"
  >
    <div ref="contentRef" class="scroll-content">
      <template v-if="useKaraoke">
        <span
          v-for="(word, i) in line!.words"
          :key="i"
          :ref="(el) => setWordRef(el, i)"
          class="tb-word"
        >
          {{ word.word }}
        </span>
      </template>
      <span v-else>{{ plainText }}</span>
    </div>
  </div>
</template>

<style scoped>
.scroll-wrapper {
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-align: left;
}
/* 未溢出时根据锚定方向对齐短文本；溢出时强制左对齐，让滚动从头开始 */
.scroll-wrapper[data-anchor="right"]:not(.is-overflow) {
  text-align: right;
}
.scroll-content {
  display: inline-block;
  pointer-events: auto;
  will-change: transform;
}
.tb-word {
  --p: 0%;
  display: inline;
  color: transparent;
  -webkit-text-fill-color: transparent;
  background: linear-gradient(
    90deg,
    var(--tbl-played) 0%,
    var(--tbl-played) calc(var(--p) - 2px),
    var(--tbl-unplayed) calc(var(--p) + 2px),
    var(--tbl-unplayed) 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
}
</style>

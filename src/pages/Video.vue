<script setup lang="ts">
defineOptions({ name: "VideoPage" });

import type { MusicCommentItem } from "@shared/types/comment";
import type { CoverItem } from "@/types/artist";
import type { VideoDetail, VideoKind, VideoSource } from "@/types/video";
import {
  getRelatedVideos,
  getVideoComments,
  getVideoDetail,
  getVideoSources,
  setVideoLiked,
  setVideoSubscribed,
} from "@/apis/video";
import { videoToCoverItem } from "@/utils/format/video";
import { formatCompact } from "@/utils/format";
import { formatDate } from "@/utils/time";
import MusicCommentCard from "@/components/comments/MusicCommentCard.vue";
import { useUserStore } from "@/stores/user";
import { useStatusStore } from "@/stores/status";
import { useCopyText } from "@/composables/useCopyText";
import { toast } from "@/composables/useToast";
import { useFloatingPlayerBar } from "@/composables/useFloatingPlayerBar";
import * as playerCore from "@/core/player";
import artistFallback from "@/assets/images/artist.jpg";
import Plyr from "plyr";
import "plyr/dist/plyr.css";
import IconLucidePlay from "~icons/lucide/play";
import IconLucideMessageCircle from "~icons/lucide/message-circle";
import IconLucideCalendarDays from "~icons/lucide/calendar-days";
import IconLucideThumbsUp from "~icons/lucide/thumbs-up";
import IconLucideShare2 from "~icons/lucide/share-2";
import IconLucideClapperboard from "~icons/lucide/clapperboard";
import IconLucideTriangleAlert from "~icons/lucide/triangle-alert";
import IconMaterialSymbolsFavoriteRounded from "~icons/material-symbols/favorite-rounded";
import IconMaterialSymbolsFavoriteOutlineRounded from "~icons/material-symbols/favorite-outline-rounded";

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const status = useStatusStore();
const user = useUserStore();
const { copy } = useCopyText();
const { isFloatingBar } = useFloatingPlayerBar();

/** 视频类型 */
const kind = computed<VideoKind>(() => (route.query.type === "video" ? "video" : "mv"));
/** 视频 id */
const videoId = computed(() => String(route.query.id ?? "").trim());

const videoRef = shallowRef<HTMLVideoElement | null>(null);
const videoPlayer = shallowRef<Plyr | null>(null);
const detail = shallowRef<VideoDetail | null>(null);
const sources = shallowRef<VideoSource[]>([]);
const related = shallowRef<CoverItem[]>([]);
const loading = ref(false);
const error = ref("");
/** 加载代次，切歌时丢弃旧响应 */
let loadToken = 0;

const detailRef = computed(() => detail.value);
const artist = computed(() => detail.value?.artists[0]);
const playCountText = computed(() =>
  detail.value ? formatCompact(detail.value.playCount, locale.value) : "",
);
const publishText = computed(() => {
  const time = detail.value?.publishTime;
  if (!time) return "";
  return formatDate(typeof time === "number" ? time : Date.parse(time));
});
const descExpanded = ref(false);

const playerOptions: Plyr.Options = {
  controls: [
    "play-large",
    "play",
    "progress",
    "current-time",
    "mute",
    "volume",
    "captions",
    "settings",
    "pip",
    "fullscreen",
  ],
  settings: ["captions", "quality", "speed"],
  ratio: "16:9",
  invertTime: false,
  autoplay: true,
  quality: {
    default: 1080,
    options: [1080, 720, 480, 240],
  },
  i18n: {
    play: t("video.player.play"),
    pause: t("video.player.pause"),
    speed: t("video.player.speed"),
    settings: t("video.player.settings"),
    normal: t("video.player.normal"),
    quality: t("video.player.quality"),
    pip: t("video.player.pip"),
    enterFullscreen: t("video.player.enterFullscreen"),
    exitFullscreen: t("video.player.exitFullscreen"),
    mute: t("video.player.mute"),
    unmute: t("video.player.unmute"),
  },
  tooltips: { controls: true },
};

/** 视频开始播放时暂停音乐，避免与 MV 声音叠加 */
const pauseMusic = (): void => {
  if (status.isPlaying) void playerCore.pause();
};

/** 应用当前清晰度列表到 Plyr */
const applySource = (): void => {
  const current = videoPlayer.value;
  const data = detail.value;
  if (!current || !data || !sources.value.length) return;
  const sorted = [...sources.value].sort((a, b) => b.quality - a.quality);
  current.source = {
    type: "video",
    title: data.title,
    poster: data.cover,
    sources: sorted.map((item) => ({
      src: item.url,
      type: "video/mp4",
      size: item.quality,
    })),
  };
};

/** 初始化 Plyr */
const initPlayer = (): void => {
  if (!videoRef.value || videoPlayer.value) return;
  const instance = new Plyr(videoRef.value, playerOptions);
  instance.on("playing", pauseMusic);
  videoPlayer.value = instance;
  applySource();
};

/** 评论分页状态（对齐歌曲评论：按页翻页） */
interface CommentState {
  list: MusicCommentItem[];
  total: number;
  page: number;
  loading: boolean;
  loaded: boolean;
}

type CommentTabKey = "hot" | "new";

const COMMENT_LIMIT = 20;

const commentTab = ref<CommentTabKey>("hot");
const comments = reactive<Record<CommentTabKey, CommentState>>({
  hot: { list: [], total: 0, page: 1, loading: false, loaded: false },
  new: { list: [], total: 0, page: 1, loading: false, loaded: false },
});
/** 各分类评论请求代次，用于丢弃过期响应 */
const commentRequests: Record<CommentTabKey, number> = { hot: 0, new: 0 };

const commentTabs = computed(() =>
  (["hot", "new"] as CommentTabKey[]).map((key) => ({
    key,
    label: `${t(`video.comments.${key}`)} (${comments[key].total})`,
  })),
);
const activePage = computed(() => comments[commentTab.value]);
/** 按当前分类总数计算页数 */
const commentMaxPage = computed(() =>
  Math.max(1, Math.ceil(activePage.value.total / Math.max(1, COMMENT_LIMIT))),
);

/** 重置评论分页 */
const resetComments = (): void => {
  for (const key of ["hot", "new"] as CommentTabKey[]) {
    commentRequests[key] += 1;
    const state = comments[key];
    state.list = [];
    state.total = 0;
    state.page = 1;
    state.loading = false;
    state.loaded = false;
  }
  commentTab.value = "hot";
};

/**
 * 加载视频评论
 * @param tab - 评论分类
 * @param page - 页码
 */
const loadComments = async (tab: CommentTabKey, page = 1): Promise<void> => {
  const state = comments[tab];
  if (!videoId.value || state.loading) return;
  const token = loadToken;
  const request = ++commentRequests[tab];
  state.loading = true;
  try {
    const data = await getVideoComments(
      kind.value,
      videoId.value,
      (page - 1) * COMMENT_LIMIT,
      COMMENT_LIMIT,
      tab === "hot",
    );
    if (token !== loadToken || request !== commentRequests[tab]) return;
    state.list = data.list;
    state.total = data.total;
    state.page = page;
    state.loaded = true;
  } catch (err) {
    if (token !== loadToken || request !== commentRequests[tab]) return;
    toast.error(err instanceof Error && err.message ? err.message : t("video.comments.failed"));
  } finally {
    if (token === loadToken && request === commentRequests[tab]) state.loading = false;
  }
};

/** 刷新评论（与歌曲评论一致，同时重拉两个分类的首屏以刷新 tab 计数） */
const refreshComments = async (): Promise<void> => {
  for (const key of ["hot", "new"] as CommentTabKey[]) {
    /** 使在途请求失效并解除 loading 占用，保证刷新可以覆盖进行中的加载 */
    commentRequests[key] += 1;
    comments[key].page = 1;
    comments[key].loading = false;
    comments[key].loaded = false;
  }
  if (commentTab.value !== "hot") commentTab.value = "hot";
  await Promise.all((["hot", "new"] as CommentTabKey[]).map((key) => loadComments(key, 1)));
};

/** 切换评论分类时按需加载 */
watch(commentTab, (tab) => {
  if (!comments[tab].loaded) void loadComments(tab, 1);
});

/** 翻页 */
const changeCommentPage = async (delta: number): Promise<void> => {
  const next = Math.min(commentMaxPage.value, Math.max(1, activePage.value.page + delta));
  if (next === activePage.value.page) return;
  await loadComments(commentTab.value, next);
};

/** 加载相关推荐（按歌手拉取同歌手 MV，接口未个性化时 simi_mv 恒定返回同一组访谈） */
const loadRelated = async (token: number, artistId?: string): Promise<void> => {
  try {
    const items = await getRelatedVideos(kind.value, videoId.value, artistId);
    if (token !== loadToken) return;
    related.value = items.map(videoToCoverItem);
  } catch {
    related.value = [];
  }
};

/**
 * 拉取视频详情、播放地址、相关推荐与热门评论
 */
const loadVideo = async (): Promise<void> => {
  const token = ++loadToken;
  loading.value = true;
  error.value = "";
  detail.value = null;
  sources.value = [];
  related.value = [];
  descExpanded.value = false;
  resetComments();
  /** 视频元素随后会重建，旧实例绑定在已移除的元素上，必须销毁 */
  videoPlayer.value?.destroy();
  videoPlayer.value = null;
  if (!videoId.value) {
    loading.value = false;
    error.value = t("video.notFound");
    return;
  }
  try {
    const data = await getVideoDetail(kind.value, videoId.value);
    if (token !== loadToken) return;
    detail.value = data;
    const qualities = data.qualities.length
      ? data.qualities.map((item) => item.br)
      : [1080, 720, 480, 240];
    const list = await getVideoSources(kind.value, videoId.value, qualities);
    if (token !== loadToken) return;
    sources.value = list;
    if (!list.length) toast.error(t("video.playbackFailed"));
    loading.value = false;
    /** 视频元素在 loading 结束后才进入 DOM，需等渲染刷新再初始化（内部应用播放源） */
    void nextTick(initPlayer);
    void loadRelated(token, data.artists[0]?.id);
    void Promise.all((["hot", "new"] as CommentTabKey[]).map((key) => loadComments(key, 1)));
  } catch (err) {
    if (token !== loadToken) return;
    loading.value = false;
    error.value = err instanceof Error && err.message ? err.message : t("video.loadFailed");
  }
};

watch([videoId, kind], loadVideo, { immediate: true });

onBeforeUnmount(() => {
  loadToken++;
  videoPlayer.value?.destroy();
  videoPlayer.value = null;
});

/** 点赞 */
const likeBusy = ref(false);

const toggleLike = async (): Promise<void> => {
  const current = detail.value;
  if (!current || likeBusy.value) return;
  likeBusy.value = true;
  const token = loadToken;
  const next = !current.liked;
  try {
    await setVideoLiked(kind.value, videoId.value, next);
    /** 切换视频后丢弃过期结果；只更新点赞字段，避免覆盖并发的收藏结果 */
    const latest = detail.value;
    if (token !== loadToken || !latest) return;
    detail.value = {
      ...latest,
      liked: next,
      likedCount: Math.max(0, latest.likedCount + (next ? 1 : -1)),
    };
  } catch (err) {
    if (token !== loadToken) return;
    toast.error(err instanceof Error && err.message ? err.message : t("video.actionFailed"));
  } finally {
    likeBusy.value = false;
  }
};

/** 收藏状态：接口未返回时以用户收藏列表为准 */
const subscribed = computed(
  () =>
    detail.value?.subscribed ||
    (kind.value === "mv" && user.mvs.some((item) => item.id === videoId.value)),
);

/** 收藏 */
const subBusy = ref(false);

const toggleSubscribe = async (): Promise<void> => {
  const current = detail.value;
  if (!current || subBusy.value) return;
  subBusy.value = true;
  const token = loadToken;
  const next = !subscribed.value;
  try {
    if (kind.value === "mv") await user.toggleMvSubscribe(videoId.value, next);
    else await setVideoSubscribed(kind.value, videoId.value, next);
    /** 切换视频后丢弃过期结果；只更新收藏字段，避免覆盖并发的点赞结果 */
    const latest = detail.value;
    if (token !== loadToken || !latest) return;
    detail.value = {
      ...latest,
      subscribed: next,
      subCount: Math.max(0, latest.subCount + (next ? 1 : -1)),
    };
  } catch (err) {
    if (token !== loadToken) return;
    toast.error(err instanceof Error && err.message ? err.message : t("video.actionFailed"));
  } finally {
    subBusy.value = false;
  }
};

/** 分享链接 */
const shareUrl = computed(() =>
  videoId.value
    ? `https://music.163.com/${kind.value === "mv" ? "mv" : "video"}/?id=${videoId.value}`
    : "",
);

const share = (): void => {
  void copy(shareUrl.value);
};

/** 打开歌手页 */
const openArtist = (): void => {
  if (!artist.value?.id) return;
  router.push(`/artist/netease/${encodeURIComponent(artist.value.id)}`);
};

/** 打开相关视频 */
const openRelated = (item: CoverItem): void => {
  router.push({ path: "/video", query: { id: item.id, type: item.videoKind ?? "mv" } });
};
</script>

<template>
  <div class="h-full overflow-y-auto [scrollbar-gutter:stable]">
    <div
      class="mx-auto flex max-w-[1100px] flex-col gap-6 px-6 pt-6"
      :class="isFloatingBar ? 'pb-28' : 'pb-10'"
    >
      <!-- 加载中 -->
      <div v-if="loading" class="flex min-h-80 items-center justify-center">
        <div class="text-center text-on-surface-variant/60">
          <SLoading class="text-4xl text-primary/70 mb-4 mx-auto block" />
          <div class="text-sm">{{ t("common.loading") }}</div>
        </div>
      </div>
      <!-- 错误态 -->
      <div v-else-if="error" class="flex min-h-80 items-center justify-center">
        <div class="text-center text-red-500/85">
          <IconLucideTriangleAlert class="size-14 mx-auto mb-4 opacity-50" />
          <div class="text-sm font-medium mb-1">{{ t("video.loadFailed") }}</div>
          <div class="text-xs opacity-80 break-all max-w-xs mb-4">{{ error }}</div>
          <SButton type="primary" variant="secondary" :disabled="!videoId" @click="loadVideo">
            <template #icon><IconLucideRefreshCw /></template>
            {{ t("common.retry") }}
          </SButton>
        </div>
      </div>
      <!-- 内容 -->
      <template v-else-if="detailRef">
        <!-- 标题与统计 -->
        <header class="flex flex-col gap-2">
          <h1 class="text-2xl font-bold leading-snug text-on-surface text-balance">
            {{ detailRef.title }}
          </h1>
          <div class="flex flex-wrap items-center gap-4 text-sm text-on-surface-variant/60">
            <span class="flex items-center gap-1.5">
              <IconLucidePlay class="size-4" />
              {{ playCountText }}
            </span>
            <span class="flex items-center gap-1.5">
              <IconLucideMessageCircle class="size-4" />
              {{ formatCompact(detailRef.commentCount, locale) }}
            </span>
            <span v-if="publishText" class="flex items-center gap-1.5">
              <IconLucideCalendarDays class="size-4" />
              {{ publishText }}
            </span>
          </div>
        </header>
        <!-- 播放器 -->
        <div class="video-player relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
          <video ref="videoRef" playsinline class="size-full" />
        </div>
        <!-- 歌手与操作 -->
        <div class="flex flex-wrap items-center justify-between gap-4">
          <button
            v-if="artist"
            type="button"
            class="group flex min-w-0 items-center gap-3 rounded-full border-none bg-transparent py-1 pl-1 pr-4 text-left transition-colors hover:bg-primary/10"
            @click="openArtist"
          >
            <SImg
              :src="artist.avatar"
              :alt="artist.name"
              class="size-10 shrink-0 rounded-full"
              :fallback="artistFallback"
            />
            <span class="min-w-0">
              <span class="block truncate text-sm font-semibold text-on-surface">
                {{ artist.name }}
              </span>
              <span class="block text-xs text-on-surface-variant/50">
                {{ t("video.visitArtist") }}
              </span>
            </span>
          </button>
          <div class="flex flex-wrap items-center gap-2">
            <SButton
              variant="secondary"
              round
              :loading="likeBusy"
              :disabled="!detailRef"
              @click="toggleLike"
            >
              <template #icon>
                <IconLucideThumbsUp class="size-4" :class="detailRef.liked ? 'text-primary' : ''" />
              </template>
              {{ formatCompact(detailRef.likedCount, locale) || t("video.like") }}
            </SButton>
            <SButton
              variant="secondary"
              round
              :loading="subBusy"
              :disabled="!detailRef"
              @click="toggleSubscribe"
            >
              <template #icon>
                <IconMaterialSymbolsFavoriteRounded v-if="subscribed" class="size-4 text-primary" />
                <IconMaterialSymbolsFavoriteOutlineRounded v-else class="size-4" />
              </template>
              {{ formatCompact(detailRef.subCount, locale) || t("video.subscribe") }}
            </SButton>
            <SButton variant="secondary" round @click="share">
              <template #icon><IconLucideShare2 class="size-4" /></template>
              {{ formatCompact(detailRef.shareCount, locale) || t("video.share") }}
            </SButton>
          </div>
        </div>
        <!-- 简介与标签（对齐旧版：详情就绪即显示，无简介给占位文案） -->
        <section class="flex flex-col gap-2">
          <p
            v-if="detailRef.description"
            class="cursor-pointer whitespace-pre-line text-sm leading-relaxed text-on-surface-variant/70"
            :class="descExpanded ? '' : 'line-clamp-3'"
            @click="descExpanded = !descExpanded"
          >
            {{ detailRef.description }}
          </p>
          <p v-else class="text-sm text-on-surface-variant/50">
            {{ t("video.noDescription") }}
          </p>
          <div v-if="detailRef.tags.length" class="flex flex-wrap gap-2">
            <STag v-for="tag in detailRef.tags" :key="tag" type="default" round size="small">
              {{ tag }}
            </STag>
          </div>
        </section>
        <!-- 相关推荐 -->
        <section v-if="related.length > 0" class="flex flex-col gap-3">
          <h2 class="text-lg font-semibold text-on-surface">{{ t("video.related") }}</h2>
          <CoverList
            :items="related"
            type="video"
            :min-size="200"
            :virtual="false"
            :gap="16"
            @click="openRelated"
          />
        </section>
        <!-- 评论（内嵌，样式与行为对齐歌曲评论） -->
        <section class="flex flex-col gap-3">
          <div class="flex shrink-0 items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <STabs v-model="commentTab" :tabs="commentTabs" type="bar" size="medium" />
            </div>
            <SButton
              variant="ghost"
              circle
              size="small"
              :loading="comments[commentTab].loading"
              @click="refreshComments"
            >
              <template #icon><IconLucideRefreshCw /></template>
            </SButton>
          </div>
          <!-- 评论列表 -->
          <div v-if="comments[commentTab].list.length > 0" class="flex flex-col gap-1.5">
            <MusicCommentCard
              v-for="comment in comments[commentTab].list"
              :key="comment.id"
              :item="comment"
            />
          </div>
          <!-- 评论空态 / 加载 -->
          <div
            v-else-if="comments[commentTab].loading"
            class="flex flex-col items-center justify-center gap-3 rounded-xl py-10 text-sm text-on-surface-variant/60"
          >
            <SLoading class="size-6 text-primary/70" />
            {{ t("video.comments.loading") }}
          </div>
          <div v-else class="flex flex-col items-center justify-center gap-1 rounded-xl py-10">
            <IconLucideMessageCircleOff class="size-10 opacity-25" />
            <div class="text-sm text-on-surface-variant/50">{{ t("video.comments.empty") }}</div>
          </div>
          <!-- 分页（最新评论多页；热门为单页） -->
          <div
            v-if="commentMaxPage > 1"
            class="flex items-center justify-between text-xs text-on-surface-variant"
          >
            <span>{{ t("comments.page", { page: activePage.page, total: commentMaxPage }) }}</span>
            <div class="flex gap-2">
              <SButton
                size="small"
                variant="secondary"
                :disabled="activePage.page <= 1 || comments[commentTab].loading"
                @click="changeCommentPage(-1)"
              >
                {{ t("common.prev") }}
              </SButton>
              <SButton
                size="small"
                variant="secondary"
                :disabled="activePage.page >= commentMaxPage || comments[commentTab].loading"
                @click="changeCommentPage(1)"
              >
                {{ t("common.next") }}
              </SButton>
            </div>
          </div>
        </section>
      </template>
      <!-- 无数据 -->
      <div v-else class="flex min-h-80 items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideClapperboard class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm">{{ t("video.empty") }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.video-player {
  --plyr-color-main: rgb(var(--s-primary));
  --plyr-video-background: transparent;
  --plyr-control-radius: 8px;
  --plyr-font-family: inherit;
}

.video-player :deep(.plyr) {
  height: 100%;
  width: 100%;
}

.video-player :deep(.plyr__control--overlaid) {
  background-color: rgb(var(--s-primary) / 0.26);
  backdrop-filter: blur(10px);
}

.video-player :deep(.plyr__control--overlaid:hover) {
  background-color: rgb(var(--s-primary) / 0.56);
}
</style>

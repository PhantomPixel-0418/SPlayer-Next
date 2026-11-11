import type { Track } from "@shared/types/player";
import { useSettingsStore } from "@/stores/settings";
import { useStreamingStore } from "@/stores/streaming";
import { usePluginsStore } from "@/stores/plugins";
import { resolveLyricForPreload, type ResolvedLyric } from "./resolve";

type PreloadedLyricResult = { hit: false } | { hit: true; lyric: ResolvedLyric };

interface PreloadedLyric {
  trackKey: string;
  contextKey: string;
  controller: { cancelled: boolean };
  /** 预载结果，未完成时为 undefined */
  lyric?: ResolvedLyric | null;
}

let preloaded: PreloadedLyric | null = null;

/** 生成歌曲身份键 */
const buildTrackKey = (track: Track): string =>
  JSON.stringify([
    track.source,
    track.serverId ?? "",
    track.originalId ?? "",
    track.id,
    track.extId ?? "",
    track.path ?? "",
    track.title,
    track.artists.map((artist) => artist.name),
  ]);

/** 生成影响歌词解析结果的上下文键 */
const buildContextKey = (): string => {
  const settings = useSettingsStore();
  const streaming = useStreamingStore();
  const plugins = usePluginsStore();
  return JSON.stringify([
    settings.lyric.lyricSourcePreference,
    settings.lyric.lyricSourceOrder,
    settings.lyric.lyricFormatOrder,
    settings.lyric.smartPreferOnline,
    settings.lyric.preferPluginLyric,
    settings.system.lyric.enableOnlineTTMLLyric,
    settings.system.localLyric.enableLocalTTMLOverride,
    settings.system.localLyric.repoDir,
    streaming.activeServerId ?? "",
    plugins.list.map((plugin) => [
      plugin.manifest.id,
      plugin.enabled,
      plugin.status.state,
      plugin.status.state === "ready" ? plugin.status.sources : null,
    ]),
  ]);
};

/** 清空下一首歌词预载结果 */
export const invalidatePreloadedLyric = (): void => {
  if (preloaded) preloaded.controller.cancelled = true;
  preloaded = null;
};

/**
 * 预载候选歌曲的最终歌词结果
 * 本地歌曲同步枚举同目录外挂歌词并按格式优先级选定，在线/流媒体走网络解析
 * @param track - 候选歌曲
 */
export const preloadLyricForTrack = (track: Track): void => {
  const trackKey = buildTrackKey(track);
  const contextKey = buildContextKey();
  if (preloaded?.trackKey === trackKey && preloaded.contextKey === contextKey) return;
  invalidatePreloadedLyric();
  const controller = { cancelled: false };
  const entry: PreloadedLyric = { trackKey, contextKey, controller };
  preloaded = entry;
  resolveLyricForPreload(track, () => !controller.cancelled)
    .then((lyric) => {
      entry.lyric = lyric;
    })
    .catch((err) => {
      console.warn("[lyricPreload] 歌词预载失败:", err);
    });
};

/**
 * 查看目标歌曲的有效预载歌词，不消费结果
 * @param track - 即将加载的歌曲
 * @returns 已完成且身份和上下文匹配的歌词，否则返回 null
 */
export const peekPreloadedLyric = (track: Track): ResolvedLyric | null => {
  if (
    !preloaded?.lyric ||
    preloaded.trackKey !== buildTrackKey(track) ||
    preloaded.contextKey !== buildContextKey()
  )
    return null;
  return preloaded.lyric;
};

/**
 * 消费目标歌曲的歌词预载结果
 * 预载未完成时直接放弃，正常流程会复用主进程的请求去重和缓存，不必等待
 * @param track - 即将加载的歌曲
 * @returns 命中状态和歌词结果
 */
export const consumePreloadedLyric = (track: Track): PreloadedLyricResult => {
  const lyric = peekPreloadedLyric(track);
  if (!lyric) {
    invalidatePreloadedLyric();
    return { hit: false };
  }
  preloaded = null;
  return { hit: true, lyric };
};

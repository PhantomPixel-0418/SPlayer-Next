import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import type { Track } from "@shared/types/player";

const mocks = vi.hoisted(() => ({
  settings: {
    player: {
      preloadNextTrack: true,
      preloadLyric: false,
      songLevel: "hq",
      allowTrialPlay: false,
      transitionMode: "crossfade",
      transitionPreference: "standard",
    },
    system: {
      cache: { songCache: { enabled: true, cacheStreaming: true } },
      lyric: { enableOnlineTTMLLyric: false },
      localLyric: { enableLocalTTMLOverride: false, repoDir: "" },
    },
    lyric: {
      lyricSourcePreference: "auto",
      lyricSourceOrder: [],
      lyricFormatOrder: [] as string[],
      smartPreferOnline: false,
      preferPluginLyric: false,
    },
    preset: { skipKeywordsSongs: false, skipTrackKeywords: [] },
  },
  status: {
    currentTrack: { id: "current" },
    state: "playing",
    trackLoading: false,
    playIndex: 0,
    fmMode: false,
    shuffleMode: "off",
  },
  candidate: { track: { id: "next", source: "netease" } },
  resolve: vi.fn(),
  prepare: vi.fn(),
  cancel: vi.fn(),
  lyric: vi.fn(),
  resolveLyric: vi.fn(),
  preload: null as typeof import("./lyric/preload") | null,
  componentStatus: vi.fn(),
  componentSubscribe: vi.fn(),
  componentUnsubscribe: vi.fn(),
}));
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/stores/status", () => ({ useStatusStore: () => mocks.status }));
vi.mock("@/stores/media", () => ({ useMediaStore: () => ({ track: { id: "current" } }) }));
vi.mock("@/stores/streaming", () => ({ useStreamingStore: () => ({ activeServerId: "server" }) }));
vi.mock("@/stores/plugins", () => ({ usePluginsStore: () => ({ list: [] }) }));
vi.mock("@/stores/queue", () => ({ queue: { value: [] } }));
vi.mock("@/core/player/candidate", () => ({ getNextTrackCandidate: () => mocks.candidate }));
vi.mock("@/services/audioSource", () => ({ resolveTrackSource: mocks.resolve }));
vi.mock("@/services/lyric/resolve", () => ({ resolveLyricForPreload: mocks.resolveLyric }));
vi.mock("@/services/lyric/preload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/lyric/preload")>();
  mocks.preload = actual;
  return {
    ...actual,
    preloadLyricForTrack: mocks.lyric,
    invalidatePreloadedLyric: vi.fn(actual.invalidatePreloadedLyric),
  };
});

describe("下一曲真实预载", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.resolve.mockReset();
    mocks.resolveLyric.mockReset();
    mocks.lyric.mockReset();
    mocks.settings.lyric.smartPreferOnline = false;
    mocks.settings.lyric.lyricFormatOrder = [];
    mocks.status = reactive({ ...mocks.status, state: "playing", trackLoading: false });
    mocks.settings = reactive(mocks.settings);
    mocks.settings.player.preloadNextTrack = true;
    mocks.settings.player.preloadLyric = false;
    mocks.settings.player.transitionMode = "crossfade";
    mocks.settings.player.transitionPreference = "standard";
    mocks.settings.system.cache.songCache = { enabled: true, cacheStreaming: true };
    mocks.candidate.track = { id: "next", source: "netease" };
    mocks.prepare.mockResolvedValue({ ready: true, autoMixStartMs: 20_000 });
    mocks.cancel.mockResolvedValue(undefined);
    mocks.componentStatus.mockResolvedValue({ state: "missing", models: [] });
    mocks.componentSubscribe.mockReturnValue(mocks.componentUnsubscribe);
    Object.assign(window, {
      api: {
        player: { prepareNext: mocks.prepare, cancelPrepared: mocks.cancel },
        automix: {
          onStatus: mocks.componentSubscribe,
          getStatus: mocks.componentStatus,
        },
      },
    });
  });

  afterEach(async () => {
    const preloader = await import("./nextTrackPreloader");
    preloader.disposeNextTrackPreload();
  });

  it.each([false, true])("音频预载未命中时仍保留匹配的歌词，音频开关：%s", async (audioEnabled) => {
    mocks.settings.player.preloadNextTrack = audioEnabled;
    mocks.settings.player.preloadLyric = true;
    const track: Track = {
      id: "local",
      source: "local",
      title: "Local",
      artists: [],
      path: "/music/local.flac",
      duration: 0,
    };
    const lyric = {
      source: { source: "external", format: "lrc" },
      input: { content: "[00:01.00]歌词" },
    };
    mocks.resolveLyric.mockResolvedValue(lyric);
    const preloader = await import("./nextTrackPreloader");
    const actual = mocks.preload!;
    actual.preloadLyricForTrack(track);
    await flushPromises();

    expect(preloader.consumePreloadedTrack(track)).toBeNull();
    expect(actual.consumePreloadedLyric(track)).toEqual({ hit: true, lyric });
    expect(actual.consumePreloadedLyric(track)).toEqual({ hit: false });
  });

  it.each(["曲目不匹配", "上下文变化", "未完成", "无歌词", "失败", "关闭歌词预载"])(
    "切歌清理无效歌词预载：%s",
    async (reason) => {
      mocks.settings.player.preloadNextTrack = false;
      mocks.settings.player.preloadLyric = true;
      const track: Track = {
        id: "local",
        source: "local",
        title: "Local",
        artists: [],
        path: "/music/local.flac",
        duration: 0,
      };
      const lyric = {
        source: { source: "external", format: "lrc" },
        input: { content: "[00:01.00]歌词" },
      };
      if (reason === "未完成") mocks.resolveLyric.mockReturnValue(new Promise(() => {}));
      else if (reason === "失败") mocks.resolveLyric.mockRejectedValue(new Error("IPC failed"));
      else mocks.resolveLyric.mockResolvedValue(reason === "无歌词" ? null : lyric);
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      const preloader = await import("./nextTrackPreloader");
      const actual = mocks.preload!;
      actual.preloadLyricForTrack(track);
      await flushPromises();
      if (reason === "关闭歌词预载") mocks.settings.player.preloadLyric = false;
      if (reason === "上下文变化") mocks.settings.lyric.smartPreferOnline = true;
      preloader.consumePreloadedTrack(
        reason === "曲目不匹配" ? { ...track, path: "/other.flac" } : track,
      );
      expect(actual.consumePreloadedLyric(track)).toEqual({ hit: false });
      expect(mocks.resolveLyric.mock.lastCall?.[1]()).toBe(false);
      warning.mockRestore();
    },
  );

  it.each(["首次调度", "解析中", "已有缓存"])("关闭歌词预载时不解析歌词：%s", async (phase) => {
    if (phase === "解析中") mocks.resolve.mockReturnValue(new Promise(() => {}));
    else
      mocks.resolve.mockResolvedValue({ source: "next.flac", provider: "local", fromCache: false });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    if (phase === "已有缓存") await flushPromises();
    if (phase !== "首次调度") preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.lyric).not.toHaveBeenCalled();
    expect(mocks.resolve).toHaveBeenCalledOnce();
  });

  it.each([
    ["解析中", false],
    ["解析中", true],
    ["已有缓存", false],
    ["已有缓存", true],
    ["加载中", false],
    ["加载中", true],
    ["交接中", true],
  ] as const)("关闭歌词预载清理歌词且保留音频：%s，歌词已完成：%s", async (phase, lyricReady) => {
    mocks.settings.player.preloadLyric = true;
    const track: Track = { id: "next", source: "local", title: "Next", artists: [], duration: 0 };
    mocks.candidate.track = track;
    const source = { source: "next.flac", provider: "local", fromCache: false };
    let finishAudio!: (value: typeof source) => void;
    mocks.resolve.mockReturnValue(new Promise((resolve) => (finishAudio = resolve)));
    let finishLyric!: (value: unknown) => void;
    mocks.resolveLyric.mockReturnValue(new Promise((resolve) => (finishLyric = resolve)));
    const lyric = {
      source: { source: "external", format: "lrc" },
      input: { content: "[00:01.00]歌词" },
    };
    const preloader = await import("./nextTrackPreloader");
    const actual = mocks.preload!;
    mocks.lyric.mockImplementation(actual.preloadLyricForTrack);
    preloader.scheduleNextTrackPreload();
    if (lyricReady) finishLyric(lyric);
    if (phase !== "解析中") finishAudio(source);
    await flushPromises();
    const preparedId = preloader.peekPreparedTrack(track)?.preparedId;
    if (phase === "交接中") {
      expect(preloader.beginPreparedTransition(track)?.preparedId).toBe(preparedId);
    }
    expect(mocks.resolveLyric.mock.calls[0][1]()).toBe(true);
    if (phase === "加载中") mocks.status.trackLoading = true;

    mocks.settings.player.preloadLyric = false;
    preloader.scheduleNextTrackPreload();

    expect(mocks.resolveLyric.mock.calls[0][1]()).toBe(false);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.resolve).toHaveBeenCalledOnce();
    if (phase === "解析中") finishAudio(source);
    if (!lyricReady) finishLyric(lyric);
    await flushPromises();
    mocks.settings.player.preloadLyric = true;
    expect(actual.consumePreloadedLyric(track)).toEqual({ hit: false });
    expect(mocks.prepare).toHaveBeenCalledOnce();
    if (phase === "交接中") {
      preloader.finishPreparedTransition(preparedId!);
      expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(preparedId);
    } else {
      expect(preloader.peekPreparedTrack(track)?.preparedId).toBeTruthy();
      expect(mocks.cancel).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["解析中", "播放中"],
    ["下载中", "播放中"],
    ["已就绪", "播放中"],
    ["解析中", "trackLoading"],
    ["下载中", "trackLoading"],
    ["已就绪", "trackLoading"],
    ["解析中", "loading"],
    ["下载中", "loading"],
    ["已就绪", "loading"],
  ])("监听音频预载关闭后清理任务且保留歌词：%s，状态：%s", async (phase, state) => {
    mocks.settings.player.preloadLyric = true;
    const track: Track = { id: "next", source: "netease", title: "Next", artists: [], duration: 0 };
    mocks.candidate.track = track;
    let finishLyric!: (value: unknown) => void;
    mocks.resolveLyric.mockReturnValue(new Promise((resolve) => (finishLyric = resolve)));
    let finishDownload!: (value: string) => void;
    const cacheRequest = vi.fn(
      (_id: string, _signal: AbortSignal) =>
        new Promise<string>((resolve) => (finishDownload = resolve)),
    );
    const source = {
      source: "https://music/next",
      provider: "official",
      fromCache: false,
      cacheRequest,
    };
    let finishSource!: (value: typeof source) => void;
    mocks.resolve.mockReturnValue(new Promise((resolve) => (finishSource = resolve)));
    const preloader = await import("./nextTrackPreloader");
    const actual = mocks.preload!;
    mocks.lyric.mockImplementation(actual.preloadLyricForTrack);
    preloader.installNextTrackPreloadWatchers();
    preloader.scheduleNextTrackPreload();
    if (phase !== "解析中") finishSource(source);
    await flushPromises();
    if (phase === "已就绪") {
      finishDownload("C:/cache/next.bin");
      await flushPromises();
      expect(preloader.peekPreparedTrack(track)?.preparedId).toBeTruthy();
    }
    mocks.status.trackLoading = state === "trackLoading";
    if (state === "loading") mocks.status.state = "loading";
    mocks.settings.player.preloadNextTrack = false;
    await flushPromises();

    expect(mocks.cancel).toHaveBeenCalledOnce();
    if (phase !== "解析中") expect(cacheRequest.mock.calls[0][1].aborted).toBe(true);
    expect(mocks.resolveLyric.mock.calls[0][1]()).toBe(true);
    if (phase === "解析中") finishSource(source);
    if (phase === "下载中") finishDownload("C:/cache/next.bin");
    const lyric = {
      source: { source: "online", format: "lrc" },
      input: { content: "[00:01.00]歌词" },
    };
    finishLyric(lyric);
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledTimes(phase === "已就绪" ? 1 : 0);
    mocks.settings.player.preloadNextTrack = true;
    expect(preloader.peekPreparedTrack(track)).toBeNull();
    expect(preloader.consumePreloadedTrack(track)).toBeNull();
    expect(actual.consumePreloadedLyric(track)).toEqual({ hit: true, lyric });
    expect(mocks.resolveLyric).toHaveBeenCalledOnce();
  });

  it("播放中切换歌词预载开关立即调度和失效", async () => {
    mocks.settings.player.preloadNextTrack = false;
    const preloader = await import("./nextTrackPreloader");
    const { invalidatePreloadedLyric } = await import("./lyric/preload");
    preloader.installNextTrackPreloadWatchers();
    mocks.settings.player.preloadLyric = true;
    await flushPromises();
    expect(mocks.lyric).toHaveBeenCalledExactlyOnceWith(mocks.candidate.track);
    expect(mocks.resolve).not.toHaveBeenCalled();
    vi.mocked(invalidatePreloadedLyric).mockClear();
    mocks.settings.player.preloadLyric = false;
    await flushPromises();
    expect(invalidatePreloadedLyric).toHaveBeenCalledOnce();
  });

  it.each([false, true])("准备音频时复用歌词预载，已有结果：%s", async (alreadyReady) => {
    mocks.settings.player.preloadLyric = true;
    const track: Track = { id: "next", source: "local", title: "Next", artists: [], duration: 0 };
    mocks.candidate.track = track;
    mocks.resolve.mockResolvedValue({ source: "next.flac", provider: "local", fromCache: false });
    let finishLyric!: (value: unknown) => void;
    mocks.resolveLyric.mockReturnValue(new Promise((resolve) => (finishLyric = resolve)));
    const lyric = {
      source: { source: "external", format: "lrc" },
      input: { content: "[00:01.00]歌词" },
    };
    const preloader = await import("./nextTrackPreloader");
    const actual = mocks.preload!;
    mocks.lyric.mockImplementation(actual.preloadLyricForTrack);
    if (alreadyReady) {
      mocks.settings.player.preloadNextTrack = false;
      preloader.scheduleNextTrackPreload();
      finishLyric(lyric);
      await flushPromises();
      mocks.settings.player.preloadNextTrack = true;
    }

    preloader.scheduleNextTrackPreload();
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    preloader.scheduleNextTrackPreload();
    expect(mocks.resolveLyric).toHaveBeenCalledOnce();
    expect(mocks.resolveLyric.mock.calls[0][1]()).toBe(true);
    expect(mocks.prepare).toHaveBeenCalledOnce();
    if (!alreadyReady) {
      finishLyric(lyric);
      await flushPromises();
    }
    expect(preloader.consumePreloadedTrack(track)?.preparedId).toBeTruthy();
    expect(actual.consumePreloadedLyric(track)).toEqual({ hit: true, lyric });
  });

  it.each(["音源为空", "音源异常", "缓存异常", "准备异常"])(
    "音频预载失败时保留歌词并允许重试：%s",
    async (failure) => {
      mocks.settings.player.preloadLyric = true;
      const track: Track = { id: "next", source: "local", title: "Next", artists: [], duration: 0 };
      mocks.candidate.track = track;
      const lyric = {
        source: { source: "external", format: "lrc" },
        input: { content: "[00:01.00]歌词" },
      };
      let finishLyric!: (value: unknown) => void;
      mocks.resolveLyric.mockReturnValue(new Promise((resolve) => (finishLyric = resolve)));
      if (failure === "音源为空") mocks.resolve.mockResolvedValueOnce(null);
      if (failure === "音源异常") mocks.resolve.mockRejectedValueOnce(new Error("source"));
      if (failure === "缓存异常")
        mocks.resolve.mockResolvedValueOnce({
          source: "https://music/next",
          provider: "official",
          fromCache: false,
          cacheRequest: vi.fn().mockRejectedValue(new Error("cache")),
        });
      if (failure === "准备异常") {
        mocks.resolve.mockResolvedValueOnce({
          source: "next.flac",
          provider: "local",
          fromCache: false,
        });
        mocks.prepare.mockRejectedValueOnce(new Error("prepare"));
      }
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      const preloader = await import("./nextTrackPreloader");
      const actual = mocks.preload!;
      mocks.lyric.mockImplementation(actual.preloadLyricForTrack);
      preloader.scheduleNextTrackPreload();
      await flushPromises();
      expect(mocks.resolveLyric.mock.calls[0][1]()).toBe(true);
      expect(mocks.cancel).toHaveBeenCalledOnce();
      finishLyric(lyric);
      await flushPromises();
      mocks.resolve.mockResolvedValueOnce({
        source: "next.flac",
        provider: "local",
        fromCache: false,
      });
      preloader.scheduleNextTrackPreload();
      await flushPromises();
      expect(mocks.resolveLyric).toHaveBeenCalledOnce();
      expect(preloader.consumePreloadedTrack(track)?.preparedId).toBeTruthy();
      expect(actual.consumePreloadedLyric(track)).toEqual({ hit: true, lyric });
      warning.mockRestore();
    },
  );

  it.each([false, true])("歌词设置变化后重新预载，音频开关：%s", async (audioEnabled) => {
    mocks.settings.player.preloadNextTrack = audioEnabled;
    mocks.settings.player.preloadLyric = true;
    mocks.settings.lyric.lyricFormatOrder = [];
    const track: Track = { id: "next", source: "local", title: "Next", artists: [], duration: 0 };
    mocks.candidate.track = track;
    mocks.resolve.mockResolvedValue({ source: "next.flac", provider: "local", fromCache: false });
    const oldLyric = {
      source: { source: "external", format: "lrc" },
      input: { content: "[00:01.00]旧歌词" },
    };
    const newLyric = {
      source: { source: "external", format: "ttml" },
      input: { content: "新歌词" },
    };
    mocks.resolveLyric.mockResolvedValueOnce(oldLyric).mockResolvedValueOnce(newLyric);
    const preloader = await import("./nextTrackPreloader");
    const actual = mocks.preload!;
    mocks.lyric.mockImplementation(actual.preloadLyricForTrack);
    preloader.installNextTrackPreloadWatchers();
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(actual.peekPreloadedLyric(track)).toEqual(oldLyric);
    mocks.settings.lyric.lyricFormatOrder = ["ttml"];
    await flushPromises();
    expect(mocks.resolveLyric).toHaveBeenCalledTimes(2);
    expect(mocks.resolveLyric.mock.calls[0][1]()).toBe(false);
    expect(actual.peekPreloadedLyric(track)).toEqual(newLyric);
    preloader.scheduleNextTrackPreload();
    expect(mocks.resolveLyric).toHaveBeenCalledTimes(2);
    preloader.consumePreloadedTrack(track);
    expect(actual.consumePreloadedLyric(track)).toEqual({ hit: true, lyric: newLyric });
    if (audioEnabled) expect(mocks.prepare).toHaveBeenCalledOnce();
    else expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("候选歌曲身份变化时不会复用旧歌词", async () => {
    mocks.settings.player.preloadNextTrack = false;
    mocks.settings.player.preloadLyric = true;
    const track: Track = { id: "next", source: "local", title: "旧标题", artists: [], duration: 0 };
    mocks.candidate.track = track;
    const oldLyric = {
      source: { source: "external", format: "lrc" },
      input: { content: "旧歌词" },
    };
    const newLyric = {
      source: { source: "external", format: "lrc" },
      input: { content: "新歌词" },
    };
    mocks.resolveLyric.mockResolvedValueOnce(oldLyric).mockResolvedValueOnce(newLyric);
    const preloader = await import("./nextTrackPreloader");
    const actual = mocks.preload!;
    mocks.lyric.mockImplementation(actual.preloadLyricForTrack);
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    const newTrack = { ...track, title: "新标题" };
    mocks.candidate.track = newTrack;
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.resolveLyric).toHaveBeenCalledTimes(2);
    expect(mocks.resolveLyric.mock.calls[0][1]()).toBe(false);
    expect(actual.consumePreloadedLyric(newTrack)).toEqual({ hit: true, lyric: newLyric });
  });

  it("已下载歌曲直接准备原生预载槽位", async () => {
    mocks.resolve.mockResolvedValueOnce({
      source: "C:/downloads/next.flac",
      provider: "download",
      fromCache: false,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.any(String),
      "C:/downloads/next.flac",
      undefined,
      "standard",
      undefined,
    );
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)?.preparedId).toEqual(
      expect.any(String),
    );
  });

  it("AutoMix 分析不可用时将 PCM 交给交叉过渡，在途检查不能反复消费和重建槽位", async () => {
    mocks.settings.player.transitionMode = "automix";
    mocks.prepare.mockResolvedValue({ ready: true });
    mocks.resolve.mockResolvedValue({
      source: "C:/cache/next.bin",
      provider: "cache",
      fromCache: true,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    const prepared = preloader.beginPreparedTransition(mocks.candidate.track as Track);
    expect(prepared?.preparedId).toBeTruthy();
    expect(prepared?.autoMixStartMs).toBeUndefined();
    expect(mocks.prepare.mock.calls[0][3]).toBe("standard");
    for (let i = 0; i < 3; i++) {
      expect(preloader.beginPreparedTransition(mocks.candidate.track as Track)).toBeNull();
      preloader.scheduleNextTrackPreload();
      await flushPromises();
    }
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)).toBeNull();
  });

  it("AutoMix 提前准备完成时不提前变速，按显示时间在计划前两秒提交", async () => {
    mocks.settings.player.transitionMode = "automix";
    mocks.prepare.mockResolvedValue({ ready: true, autoMixStartMs: 20_000 });
    mocks.resolve.mockResolvedValue({ source: "next.flac", provider: "local", fromCache: false });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    const track = mocks.candidate.track as Track;
    expect(preloader.beginPreparedTransition(track, undefined, 10_000)).toBeNull();
    expect(preloader.beginPreparedTransition(track, undefined, 17_999)).toBeNull();
    expect(preloader.peekPreparedTrack(track)?.preparedId).toBeTruthy();
    expect(preloader.beginPreparedTransition(track, undefined, 18_000)?.preparedId).toBeTruthy();
    expect(mocks.prepare).toHaveBeenCalledOnce();
  });

  it("原生交接拒绝后保留音源等待正常切歌，后续进度检查不再创建 PCM", async () => {
    mocks.resolve.mockResolvedValue({ source: "next.flac", provider: "local", fromCache: false });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    const prepared = preloader.beginPreparedTransition(mocks.candidate.track as Track)!;
    preloader.finishPreparedTransition(prepared.preparedId!, prepared);
    for (let i = 0; i < 3; i++) {
      preloader.scheduleNextTrackPreload();
      expect(preloader.beginPreparedTransition(mocks.candidate.track as Track)).toBeNull();
      await flushPromises();
    }
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(prepared.preparedId);
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)?.source?.source).toBe(
      "next.flac",
    );
  });

  it("下载进度不作废 PCM，全部组件就绪后重新准备 AutoMix", async () => {
    mocks.settings.player.transitionMode = "automix";
    mocks.resolve.mockResolvedValue({ source: "next.flac", provider: "local", fromCache: false });
    const service = await import("./automix");
    service.autoMixComponentStatus.value = {
      state: "missing",
      models: [
        { id: "beat", state: "ready", received: 1, total: 1 },
        { id: "runtime", state: "ready", received: 1, total: 1 },
      ],
    };
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    for (const received of [0, 50, 99]) {
      service.autoMixComponentStatus.value = {
        state: received === 99 ? "ready" : "downloading",
        models: [
          { id: "beat", state: "ready", received: 1, total: 1 },
          { id: "runtime", state: "ready", received: 1, total: 1 },
          {
            id: "demucs",
            state: received === 99 ? "ready" : "downloading",
            received,
            total: 99,
          },
        ],
      };
      preloader.scheduleNextTrackPreload();
      await flushPromises();
    }
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });

  it("解析返回空值后允许同一候选重新预载", async () => {
    mocks.resolve.mockResolvedValueOnce(null).mockResolvedValueOnce({
      source: "C:/cache/next.bin",
      provider: "cache",
      fromCache: true,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.resolve).toHaveBeenCalledTimes(2);
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(
      preloader.consumePreloadedTrack(mocks.candidate.track as Track)?.preparedId,
    ).toBeTruthy();
  });

  it("当前歌曲加载完成前不启动下一曲预载", async () => {
    mocks.status.state = "loading";
    mocks.resolve.mockResolvedValue({
      source: "C:/cache/next.bin",
      provider: "cache",
      fromCache: true,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.installNextTrackPreloadWatchers();
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.resolve).not.toHaveBeenCalled();
    mocks.status.state = "playing";
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledOnce();
  });

  it("停止播放会取消在途下载，迟到结果不能创建槽位，恢复后可重新预载", async () => {
    let finish!: (path: string) => void;
    const cacheRequest = vi.fn(
      (_id: string, _signal: AbortSignal) =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    mocks.resolve.mockResolvedValueOnce({
      source: "https://music/next",
      provider: "official",
      fromCache: false,
      cacheRequest,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.installNextTrackPreloadWatchers();
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    mocks.status.state = "stopped";
    await flushPromises();
    const [id, signal] = cacheRequest.mock.calls[0]!;
    expect(signal.aborted).toBe(true);
    expect(mocks.cancel).toHaveBeenCalledWith(id);
    finish("C:/cache/next.bin");
    await flushPromises();
    expect(mocks.prepare).not.toHaveBeenCalled();
    mocks.resolve.mockResolvedValue({
      source: "C:/cache/next.bin",
      provider: "cache",
      fromCache: true,
    });
    mocks.status.state = "playing";
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledOnce();
  });

  it("停止后迟到的解析结果不能恢复预载", async () => {
    let finish!: (source: unknown) => void;
    mocks.resolve.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const preloader = await import("./nextTrackPreloader");
    preloader.installNextTrackPreloadWatchers();
    preloader.scheduleNextTrackPreload();
    mocks.status.state = "stopped";
    await flushPromises();
    finish({ source: "C:/cache/next.bin", provider: "cache", fromCache: true });
    await flushPromises();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)).toBeNull();
  });

  it("暂停保留在途预载，暂停后的结果仍可消费", async () => {
    let finish!: (source: unknown) => void;
    mocks.resolve.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const preloader = await import("./nextTrackPreloader");
    preloader.installNextTrackPreloadWatchers();
    preloader.scheduleNextTrackPreload();
    mocks.status.state = "paused";
    await flushPromises();
    expect(mocks.resolve).toHaveBeenCalledOnce();
    expect(mocks.cancel).not.toHaveBeenCalled();
    finish({ source: "C:/cache/next.bin", provider: "cache", fromCache: true });
    await flushPromises();
    expect(
      preloader.consumePreloadedTrack(mocks.candidate.track as Track)?.preparedId,
    ).toBeTruthy();
  });

  it("旧任务返回空值不会清理新任务的预载结果", async () => {
    let finish!: (source: null) => void;
    mocks.resolve.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    preloader.invalidateNextTrackPreload();
    mocks.resolve.mockResolvedValueOnce({
      source: "C:/cache/next.bin",
      provider: "cache",
      fromCache: true,
    });
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    const id = mocks.prepare.mock.calls[0]![0];
    finish(null);
    await flushPromises();
    expect(mocks.cancel).not.toHaveBeenCalledWith(id);
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)?.preparedId).toBe(id);
  });

  it("替换播放列表后等待当前曲加载完成，再准备下一首槽位", async () => {
    mocks.candidate.track.source = "local";
    mocks.resolve.mockResolvedValue({
      source: "C:/music/next.flac",
      provider: "local",
      fromCache: false,
    });
    const preloader = await import("./nextTrackPreloader");

    mocks.status.trackLoading = true;
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();

    mocks.status.trackLoading = false;
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(preloader.peekPreparedTrack(mocks.candidate.track as Track)?.preparedId).toBeDefined();
  });

  it.each([
    { enabled: false, cacheStreaming: false },
    { enabled: true, cacheStreaming: false },
    { enabled: false, cacheStreaming: true },
  ])("本地歌曲不依赖网络缓存开关：%j", async (cache) => {
    mocks.settings.system.cache.songCache = cache;
    mocks.candidate.track.source = "local";
    mocks.resolve.mockResolvedValue({
      source: "C:/music/next.flac",
      provider: "local",
      fromCache: false,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.any(String),
      "C:/music/next.flac",
      undefined,
      "standard",
      undefined,
    );
    expect(preloader.peekPreparedTrack(mocks.candidate.track as Track)?.preparedId).toBeDefined();
  });

  it("关闭缓存时本地 CUE 仍按片段起点准备", async () => {
    mocks.settings.system.cache.songCache = { enabled: false, cacheStreaming: false };
    Object.assign(mocks.candidate.track, {
      source: "local",
      cueAudioPath: "C:/music/album.flac",
      cueStartMs: 120000,
      cueEndMs: 240000,
    });
    mocks.resolve.mockResolvedValue({
      source: "C:/music/album.flac",
      provider: "local",
      fromCache: false,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.any(String),
      "C:/music/album.flac",
      120000,
      "standard",
      undefined,
    );
    expect(preloader.peekPreparedTrack(mocks.candidate.track as Track)?.preparedId).toBeDefined();
  });

  it("等待缓存完成后才准备原生槽位，并将缓存路径与代次交给切歌", async () => {
    let finish!: (path: string) => void;
    const cacheRequest = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    mocks.resolve.mockResolvedValue({
      source: "https://music/next",
      provider: "official",
      fromCache: false,
      cacheRequest,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.prepare).not.toHaveBeenCalled();
    finish("C:/cache/next.bin");
    await flushPromises();
    const id = mocks.prepare.mock.calls[0]![0];
    expect(mocks.prepare).toHaveBeenCalledWith(
      id,
      "C:/cache/next.bin",
      undefined,
      "standard",
      undefined,
    );
    const result = preloader.consumePreloadedTrack(mocks.candidate.track as Track);
    expect(result?.preparedId).toBe(id);
    expect(result?.source?.source).toBe("C:/cache/next.bin");
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)).toBeNull();
  });

  it("队列作废会取消缓存消费者，迟到下载不得打开原生槽位", async () => {
    let finish!: (path: string) => void;
    const cacheRequest = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    mocks.resolve.mockResolvedValue({
      source: "https://music/next",
      provider: "official",
      fromCache: false,
      cacheRequest,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    preloader.invalidateNextTrackPreload();
    const [id, signal] = cacheRequest.mock.calls[0] as unknown as [string, AbortSignal];
    expect(signal.aborted).toBe(true);
    expect(mocks.cancel).toHaveBeenCalledWith(id);
    finish("C:/cache/next.bin");
    await flushPromises();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)).toBeNull();
  });

  it("未准备完就切歌时取消准备任务，不能消费未就绪资源", async () => {
    let finish!: (ready: boolean) => void;
    mocks.resolve.mockResolvedValue({
      source: "C:/cache/next.bin",
      provider: "cache",
      fromCache: true,
    });
    mocks.prepare.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)).toBeNull();
    expect(mocks.cancel).toHaveBeenCalledWith(mocks.prepare.mock.calls[0]![0]);
    finish(true);
    await flushPromises();
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)).toBeNull();
  });

  it.each([
    { enabled: false, cacheStreaming: false },
    { enabled: true, cacheStreaming: false },
    { enabled: false, cacheStreaming: true },
  ])("音频缓存不可用时保留在途歌词预载：%j", async (cache) => {
    mocks.settings.player.preloadLyric = true;
    mocks.settings.system.cache.songCache = cache;
    const track: Track = {
      id: "next",
      source: "streaming",
      title: "Next",
      artists: [{ name: "Artist" }],
      duration: 0,
    };
    mocks.candidate.track = track;
    let finishLyric!: (value: unknown) => void;
    mocks.resolveLyric.mockReturnValue(new Promise((resolve) => (finishLyric = resolve)));
    const preloader = await import("./nextTrackPreloader");
    const actual = mocks.preload!;
    mocks.lyric.mockImplementation(actual.preloadLyricForTrack);

    preloader.scheduleNextTrackPreload();
    preloader.scheduleNextTrackPreload();
    expect(mocks.resolveLyric).toHaveBeenCalledOnce();
    expect(mocks.resolveLyric.mock.calls[0][1]()).toBe(true);
    expect(mocks.resolve).not.toHaveBeenCalled();
    const lyric = {
      source: { source: "online", format: "lrc" },
      input: { content: "[00:01.00]歌词" },
    };
    finishLyric(lyric);
    await flushPromises();
    expect(preloader.consumePreloadedTrack(track)).toBeNull();
    expect(actual.consumePreloadedLyric(track)).toEqual({ hit: true, lyric });
  });

  it("关闭流媒体缓存会取消在途音频并保留歌词", async () => {
    mocks.settings.player.preloadLyric = true;
    const track: Track = {
      id: "next",
      source: "streaming",
      title: "Next",
      artists: [],
      duration: 0,
    };
    mocks.candidate.track = track;
    const lyric = {
      source: { source: "online", format: "lrc" },
      input: { content: "[00:01.00]歌词" },
    };
    mocks.resolveLyric.mockResolvedValue(lyric);
    let finishAudio!: (value: string) => void;
    const cacheRequest = vi.fn(
      (_id: string, _signal: AbortSignal) =>
        new Promise<string>((resolve) => (finishAudio = resolve)),
    );
    mocks.resolve.mockResolvedValue({
      source: "https://music/next",
      provider: "official",
      fromCache: false,
      cacheRequest,
    });
    const preloader = await import("./nextTrackPreloader");
    const actual = mocks.preload!;
    mocks.lyric.mockImplementation(actual.preloadLyricForTrack);
    preloader.scheduleNextTrackPreload();
    await flushPromises();

    mocks.settings.system.cache.songCache.cacheStreaming = false;
    preloader.scheduleNextTrackPreload();
    const [id, signal] = cacheRequest.mock.calls[0]!;
    expect(signal.aborted).toBe(true);
    expect(mocks.cancel).toHaveBeenCalledWith(id);
    finishAudio("C:/cache/next.bin");
    await flushPromises();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(preloader.consumePreloadedTrack(track)).toBeNull();
    expect(actual.consumePreloadedLyric(track)).toEqual({ hit: true, lyric });
  });

  it("关闭缓存后不再启动预载", async () => {
    mocks.settings.system.cache.songCache.enabled = false;
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("试听和缓存失败仍保留正常加载路径，不假报原生预载成功", async () => {
    mocks.resolve.mockResolvedValue({
      source: "https://music/trial",
      provider: "trial",
      fromCache: false,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(
      preloader.consumePreloadedTrack(mocks.candidate.track as Track)?.preparedId,
    ).toBeUndefined();
  });

  it.each(["关闭过渡", "修改倾向", "关闭预载"])("%s 时保留已提交交接的所有权", async (change) => {
    mocks.resolve.mockResolvedValue({
      source: "C:/cache/next.bin",
      provider: "cache",
      fromCache: true,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.installNextTrackPreloadWatchers();
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    const prepared = preloader.beginPreparedTransition(mocks.candidate.track as Track)!;
    expect(prepared.preparedId).toBeTruthy();
    if (change === "关闭过渡") mocks.settings.player.transitionMode = "none";
    if (change === "修改倾向") mocks.settings.player.transitionPreference = "eager";
    if (change === "关闭预载") mocks.settings.player.preloadNextTrack = false;
    await flushPromises();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(preloader.consumePreloadedTrack(mocks.candidate.track as Track)).toBeNull();
    expect(mocks.cancel).not.toHaveBeenCalled();
    preloader.finishPreparedTransition(prepared.preparedId!);
    await flushPromises();
    expect(mocks.cancel).toHaveBeenCalledWith(prepared.preparedId);
    expect(mocks.prepare).toHaveBeenCalledTimes(change === "关闭预载" ? 1 : 2);
  });

  it("迟到槽位通知不能取走当前备用槽位", async () => {
    mocks.resolve.mockResolvedValue({
      source: "C:/cache/next.bin",
      provider: "cache",
      fromCache: true,
    });
    const preloader = await import("./nextTrackPreloader");
    preloader.scheduleNextTrackPreload();
    await flushPromises();
    expect(
      preloader.beginPreparedTransition(mocks.candidate.track as Track, "old-slot"),
    ).toBeNull();
    expect(preloader.peekPreparedTrack(mocks.candidate.track as Track)?.preparedId).toBeTruthy();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

const mocks = vi.hoisted(() => {
  const track = { id: "next", source: "netease", title: "Next", artists: [], duration: 1000 };
  const media = {
    track: { ...track, id: "old" },
    setPlaybackContext: vi.fn(),
    enrichTrack: vi.fn(),
  };
  return {
    track,
    media,
    status: {
      currentTrack: track,
      playIndex: 0,
      shuffleMode: "off",
      isPlaying: true,
      state: "playing",
      currentSource: "old",
    },
    consume: vi.fn(),
    resolve: vi.fn(),
    load: vi.fn(),
    stop: vi.fn(),
    invalidate: vi.fn(),
  };
});
vi.mock("./events", () => ({ handleEvent: vi.fn() }));
vi.mock("./fm", () => ({}));
vi.mock("./stats", () => ({ installPlayStats: vi.fn() }));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({ preset: { skipKeywordsSongs: false } }),
}));
vi.mock("@/stores/status", () => ({ useStatusStore: () => mocks.status }));
vi.mock("@/stores/media", () => ({
  useMediaStore: () => ({
    ...mocks.media,
    setTrack: (track: typeof mocks.track) => {
      mocks.media.track = track;
    },
  }),
}));
vi.mock("@/stores/streaming", () => ({ useStreamingStore: vi.fn() }));
vi.mock("@/stores/plugins", () => ({ usePluginsStore: vi.fn() }));
vi.mock("@/stores/history", () => ({ useHistoryStore: () => ({ record: vi.fn() }) }));
vi.mock("@/stores/library", () => ({ useLibraryStore: vi.fn() }));
vi.mock("@/stores/queue", () => ({ setQueue: vi.fn(), updateQueueTracks: vi.fn() }));
vi.mock("@/services/playback", () => ({
  reset: vi.fn(),
  setCurrentTime: vi.fn(),
  setDuration: vi.fn(),
  setPlaying: vi.fn(),
  setSeeking: vi.fn(),
}));
vi.mock("@/services/lyric/loader", () => ({ beginLoad: vi.fn(), loadForTrack: vi.fn() }));
vi.mock("@/services/coverLoader", () => ({ loadCoverForTrack: vi.fn() }));
vi.mock("@/services/abLoop", () => ({ reset: vi.fn() }));
vi.mock("@/services/cacheScheduler", () => ({ cancel: vi.fn(), schedule: vi.fn() }));
vi.mock("@/services/deviceVolume", () => ({ getDeviceVolume: vi.fn(), setDeviceVolume: vi.fn() }));
vi.mock("@/services/audioSource", () => ({ resolveTrackSource: mocks.resolve }));
vi.mock("@/services/nextTrackPreloader", () => ({
  invalidateNextTrackPreload: mocks.invalidate,
  consumePreloadedTrack: mocks.consume,
  disposeNextTrackPreload: vi.fn(),
  installNextTrackPreloadWatchers: vi.fn(),
  scheduleNextTrackPreload: vi.fn(),
}));
vi.mock("@/composables/useFavorite", () => ({ useFavorite: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: { info: vi.fn() } }));
vi.mock("@/utils/color", () => ({ extractColorFromUrl: vi.fn() }));
vi.mock("@/utils/errors", () => ({
  handleError: vi.fn(),
  isSkippableError: (code: string) => code === "FILE_DECODE_ERROR",
}));
vi.mock("@/utils/preset/skipKeywords", () => ({ shouldSkipKeywordTrack: () => false }));
vi.mock("@/i18n", () => ({ default: { global: { t: (value: string) => value } } }));

describe("切歌消费真实预载", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.media.track = { ...mocks.track, id: "old" };
    mocks.load.mockResolvedValue({
      success: true,
      data: { detail: {}, mediaInfo: { duration: 1000 } },
    });
    mocks.stop.mockResolvedValue({ success: true });
    Object.assign(window, { api: { player: { load: mocks.load, stop: mocks.stop } } });
  });

  it("主动停止在等待主进程响应前就作废预载", async () => {
    let finish!: (result: { success: boolean }) => void;
    mocks.stop.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { stop } = await import("./index");
    const pending = stop();
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    finish({ success: true });
    await pending;
  });

  it("准备完成的槽位直接交给 load，不能先 stop 清除它", async () => {
    mocks.consume.mockReturnValue({
      preparedId: "prepared",
      source: { source: "C:/cache/next.bin", fromCache: true, provider: "cache" },
    });
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(mocks.load).toHaveBeenCalledWith(
      "C:/cache/next.bin",
      expect.objectContaining({ preparedId: "prepared" }),
    );
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("没有就绪槽位时保留正常停止、解析和加载流程", async () => {
    mocks.consume.mockReturnValue(null);
    mocks.resolve.mockResolvedValue({
      source: "https://music/next",
      fromCache: false,
      provider: "official",
    });
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.load).toHaveBeenCalledWith(
      "https://music/next",
      expect.objectContaining({ preparedId: undefined }),
    );
  });

  it("缓存音源失效后重新解析，并且不能把旧槽位代次带到重试中", async () => {
    mocks.consume.mockReturnValue({
      preparedId: "stale",
      source: { source: "C:/cache/next.bin", fromCache: true, provider: "cache" },
    });
    mocks.load.mockResolvedValueOnce({ success: false, error: "FILE_DECODE_ERROR" });
    mocks.resolve.mockResolvedValue({
      source: "https://music/retry",
      fromCache: false,
      provider: "official",
    });
    const { playFrom } = await import("./index");
    await playFrom([mocks.track as Track]);
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(mocks.load.mock.calls[1]).toEqual([
      "https://music/retry",
      expect.objectContaining({ preparedId: undefined }),
    ]);
  });
});

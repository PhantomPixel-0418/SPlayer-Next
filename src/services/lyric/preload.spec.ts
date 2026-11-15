import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import type { LyricData } from "@shared/types/lyrics";
import type { LyricInput } from "lyric-kit";

const mockResolveLyricForPreload = vi.fn();
const mockParseLyricForDisplay = vi.fn();
const mockEnhance = vi.fn();
const settings = {
  locale: "zh-CN",
  lyric: {
    llmTranslation: false,
    pronunciationOptimization: false,
    pronunciationGranularity: "word",
    llmRuby: false,
  },
  system: { lyric: {}, localLyric: {} },
};

vi.mock("./resolve", () => ({
  resolveLyricForPreload: (...args: unknown[]) => mockResolveLyricForPreload(...args),
}));

vi.mock("./displayParse", () => ({
  parseLyricForDisplay: (...args: unknown[]) => mockParseLyricForDisplay(...args),
}));

vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => settings,
}));

vi.mock("@/stores/streaming", () => ({
  useStreamingStore: () => ({ activeServerId: null }),
}));

vi.mock("@/stores/plugins", () => ({
  usePluginsStore: () => ({ list: [] }),
}));

import { consumePreloadedLyric, invalidatePreloadedLyric, preloadLyricForTrack } from "./preload";

const track: Track = {
  id: "song",
  source: "netease",
  title: "Song",
  artists: [{ id: "a1", name: "Artist" }],
  duration: 180_000,
};

const lyric: { source: NonNullable<LyricData>; input: LyricInput } = {
  source: { source: "online", format: "lrc" },
  input: { content: "[00:01.00]Hello" },
};
const parsedLine = {
  words: [{ word: "君", startTime: 1000, endTime: 2000 }],
  translatedLyric: "",
  romanLyric: "",
  language: "ja",
  startTime: 1000,
  endTime: 2000,
};

/** 刷新预载解析与预热所经过的微任务队列 */
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("consumePreloadedLyric", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    settings.locale = "zh-CN";
    settings.lyric.llmTranslation = false;
    settings.lyric.pronunciationOptimization = false;
    settings.lyric.pronunciationGranularity = "word";
    settings.lyric.llmRuby = false;
    mockEnhance.mockResolvedValue({ lines: [parsedLine], warnings: [] });
    mockParseLyricForDisplay.mockReturnValue({
      lines: [parsedLine],
      authors: [],
      hasWordTiming: false,
    });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { lyricEnhancement: { enhance: mockEnhance } },
    });
    invalidatePreloadedLyric();
  });

  it("预载尚未完成时不等待，并取消预载", async () => {
    mockResolveLyricForPreload.mockReturnValue(new Promise(() => {}));
    preloadLyricForTrack(track);

    expect(consumePreloadedLyric(track)).toEqual({ hit: false });
    expect(mockResolveLyricForPreload.mock.calls[0][1]()).toBe(false);
  });

  it("预载已完成时返回结果", async () => {
    mockResolveLyricForPreload.mockResolvedValue(lyric);
    preloadLyricForTrack(track);
    await flush();

    expect(consumePreloadedLyric(track)).toEqual({ hit: true, lyric });
  });
});

describe("预载歌词增强预热", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    settings.locale = "zh-CN";
    settings.lyric.llmTranslation = false;
    settings.lyric.pronunciationOptimization = false;
    settings.lyric.pronunciationGranularity = "word";
    settings.lyric.llmRuby = false;
    mockEnhance.mockResolvedValue({ lines: [parsedLine], warnings: [] });
    mockParseLyricForDisplay.mockReturnValue({
      lines: [parsedLine],
      authors: [],
      hasWordTiming: false,
    });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { lyricEnhancement: { enhance: mockEnhance } },
    });
    invalidatePreloadedLyric();
  });

  it("开启增强后按切歌相同管线构造预热请求", async () => {
    settings.lyric.llmTranslation = true;
    settings.lyric.pronunciationOptimization = true;
    settings.lyric.llmRuby = true;
    mockResolveLyricForPreload.mockResolvedValue(lyric);
    preloadLyricForTrack(track);
    await flush();

    expect(mockParseLyricForDisplay).toHaveBeenCalledWith({
      source: lyric.source,
      input: lyric.input,
      track,
    });
    expect(mockEnhance).toHaveBeenCalledWith({
      versionKey: JSON.stringify([
        track.source,
        track.serverId,
        track.serverRevision,
        track.id,
        lyric.source.source,
        lyric.source.platform,
        lyric.source.format,
      ]),
      locale: "zh-CN",
      lines: [parsedLine],
      translate: true,
      pronunciation: true,
      pronunciationGranularity: "word",
      ruby: true,
    });
  });

  it("增强开关全关、歌词为空、预载取消、已有音译和注音时不发起预热", async () => {
    mockResolveLyricForPreload.mockResolvedValueOnce(lyric).mockResolvedValueOnce(null);
    preloadLyricForTrack(track);
    await flush();

    invalidatePreloadedLyric();
    preloadLyricForTrack(track);
    await flush();

    settings.lyric.llmTranslation = true;
    let finish!: (value: typeof lyric | null) => void;
    mockResolveLyricForPreload.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    preloadLyricForTrack(track);
    invalidatePreloadedLyric();
    finish(lyric);
    await flush();

    settings.lyric.pronunciationOptimization = true;
    settings.lyric.llmRuby = true;
    settings.lyric.llmTranslation = false;
    mockParseLyricForDisplay.mockReturnValueOnce({
      lines: [
        {
          ...parsedLine,
          words: [
            {
              word: "君",
              startTime: 1000,
              endTime: 2000,
              romanWord: "kimi",
              ruby: [{ word: "きみ", startTime: 1000, endTime: 2000 }],
            },
            { word: "は", startTime: 2000, endTime: 3000, romanWord: "wa" },
          ],
        },
      ],
      authors: [],
      hasWordTiming: false,
    });
    invalidatePreloadedLyric();
    preloadLyricForTrack(track);
    await flush();

    expect(mockEnhance).not.toHaveBeenCalled();
  });
});

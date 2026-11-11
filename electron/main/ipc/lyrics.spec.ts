import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handle: vi.fn(), access: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: { handle: mocks.handle }, dialog: {} }));
vi.mock("node:fs/promises", () => ({ access: mocks.access }));
vi.mock("@main/apis/common/lyric/netease", () => ({}));
vi.mock("@main/apis/common/lyric/qqmusic", () => ({}));
vi.mock("@main/apis/common/lyric/kugou", () => ({}));
vi.mock("@main/apis/common/lyric/ttml", () => ({}));
vi.mock("@main/services/localLyricRepo", () => ({}));
vi.mock("@main/database/lyricMatchCache", () => ({}));
vi.mock("@main/utils/logger", () => ({ coreLog: { warn: vi.fn() } }));

import { registerLyricsIpc } from "./lyrics";

/** 注册并取得外挂歌词发现处理器 */
const discoveryHandler = () => {
  registerLyricsIpc();
  return mocks.handle.mock.calls.find(
    ([channel]) => channel === "lyrics:findLocalExternalLyrics",
  )![1];
};

describe("外挂歌词异步发现", () => {
  beforeEach(() => {
    mocks.handle.mockClear();
    mocks.access.mockReset();
    mocks.access.mockResolvedValue(undefined);
  });

  it("保留格式顺序，并跳过缺失和不可访问文件", async () => {
    mocks.access.mockImplementation(async (path: string) => {
      if (!path.endsWith(".ttml") && !path.endsWith(".lrc")) throw new Error("unavailable");
    });
    const handler = discoveryHandler();
    // join 让期望路径跟随 node:path 的平台分隔符，避免 Windows 上 /\ 差异
    await expect(handler({}, "/music/song.flac")).resolves.toEqual({
      success: true,
      data: [
        { format: "ttml", path: join("/music", "song.ttml") },
        { format: "lrc", path: join("/music", "song.lrc") },
      ],
    });
    expect(mocks.access).toHaveBeenCalledTimes(8);
  });

  it("慢目录不阻塞事件循环，同路径复用请求，其他路径不排队", async () => {
    let release!: () => void;
    mocks.access.mockReturnValueOnce(new Promise<void>((resolve) => (release = resolve)));
    const handler = discoveryHandler();
    const first = handler({}, "/slow/song.flac");
    const same = handler({}, "/slow/song.flac");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(mocks.access).toHaveBeenCalledTimes(1);
    const others = Array.from({ length: 20 }, (_, i) => handler({}, `/other/${i}.flac`));
    await expect(Promise.all(others)).resolves.toEqual(
      Array.from({ length: 20 }, () => ({ success: true, data: [] })),
    );
    expect(mocks.access).toHaveBeenCalledTimes(1);
    release();
    const [a, b] = await Promise.all([first, same]);
    expect(a).toEqual(b);
    expect(a.data).toHaveLength(8);
    expect(mocks.access).toHaveBeenCalledTimes(8);
    await handler({}, "/other/new.flac");
    expect(mocks.access).toHaveBeenCalledTimes(16);
  });

  it("所有检查失败后释放扫描槽位", async () => {
    mocks.access.mockRejectedValue(new Error("offline mount"));
    const handler = discoveryHandler();
    await expect(handler({}, "/offline/song.flac")).resolves.toEqual({ success: true, data: [] });
    mocks.access.mockResolvedValue(undefined);
    const next = await handler({}, "/music/next.flac");
    expect(next.success).toBe(true);
    expect(next.data).toHaveLength(8);
  });

  it.each([null, 42, ""])("拒绝无效路径：%s", async (path) => {
    await expect(discoveryHandler()({}, path)).resolves.toEqual({
      success: false,
      error: "invalid audio path",
    });
    expect(mocks.access).not.toHaveBeenCalled();
  });
});

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LyricDictionaryStatus } from "@shared/types/lyricEnhancement";

/**
 * 创建独立的词典下载与加载状态
 * @param options - 词典目录和运行时依赖
 * @returns 词典生命周期操作
 */
export function createLyricDictionaryStore(options: {
  root: string;
  version: string;
  files: Record<string, string>;
  fetchFile: typeof fetch;
}) {
  const { root, version, files, fetchFile } = options;
  const directory = path.join(root, version);
  let download: Promise<void> | undefined;

  /** 获取词典安装和下载状态 */
  async function getLyricDictionaryStatus(): Promise<LyricDictionaryStatus> {
    let installed = false;
    try {
      installed = (await fs.readFile(path.join(directory, "complete"), "utf8")) === version;
      if (installed)
        await Promise.all(Object.keys(files).map((name) => fs.access(path.join(directory, name))));
    } catch {
      installed = false;
    }
    return { installed, downloading: Boolean(download), version };
  }

  /** 下载固定版本词典并验证每个文件 */
  async function downloadLyricDictionary(): Promise<LyricDictionaryStatus> {
    if (!download) {
      download = (async () => {
        if ((await getLyricDictionaryStatus()).installed) return;
        await fs.mkdir(root, { recursive: true });
        const temporary = path.join(root, `.download-${randomUUID()}`);
        await fs.mkdir(temporary);
        try {
          for (const [name, hash] of Object.entries(files)) {
            const response = await fetchFile(
              `https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/${name}`,
              {
                signal: AbortSignal.timeout(60_000),
              },
            );
            if (!response.ok || !response.body) throw new Error(`词典下载失败: ${name}`);
            const chunks: Uint8Array[] = [];
            let size = 0;
            for await (const chunk of response.body) {
              size += chunk.length;
              if (size > 7_000_000) throw new Error(`词典文件过大: ${name}`);
              chunks.push(chunk);
            }
            const data = Buffer.concat(chunks);
            if (createHash("sha256").update(data).digest("hex") !== hash)
              throw new Error(`词典文件校验失败: ${name}`);
            await fs.writeFile(path.join(temporary, name), data);
          }
          await fs.writeFile(path.join(temporary, "complete"), version);
          await fs.rm(directory, { recursive: true, force: true });
          await fs.rename(temporary, directory);
        } finally {
          await fs.rm(temporary, { recursive: true, force: true });
        }
      })().finally(() => {
        download = undefined;
      });
    }
    await download;
    return getLyricDictionaryStatus();
  }

  /** 删除已下载词典并释放分词器 */
  async function removeLyricDictionary(): Promise<LyricDictionaryStatus> {
    if (download) await download.catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
    return getLyricDictionaryStatus();
  }

  return { getLyricDictionaryStatus, downloadLyricDictionary, removeLyricDictionary };
}

import path from "node:path";
import type { LyricLine } from "@shared/types/lyrics";
import { defaultCacheDir } from "@main/utils/paths";
import { optimizeJapaneseLine } from "./lyricDictionaryCore";
import { createLyricDictionaryStore } from "./lyricDictionaryStore";
import { createLyricDictionaryWorker } from "./lyricDictionaryWorker";

const version = "kuromoji-0.1.2";
const root = path.join(defaultCacheDir, "lyric-dictionary");
const files: Record<string, string> = {
  "base.dat.gz": "0803327762e1c93ca731e4319ab8343340f2806bb84941207782cde9d2d5a8eb",
  "cc.dat.gz": "02b7631be0d4de3a1a75cd9f9cc51536e4f94c9e6b389b813e06ba0f6e7de765",
  "check.dat.gz": "193ae0035fff6fe812b58d9ee730e7a7d7ee601d918481ce51075c58114f6cc9",
  "tid_map.dat.gz": "33efd5ffd87a70f669add093fa39dee44341d58f940844ef107c8fd98bb795b2",
  "tid_pos.dat.gz": "60dbfc99a6ab993f30c5dab648bec6ad7f9aaefa5c14e1843837d95e509f8895",
  "tid.dat.gz": "d43d831cb6fb0f0a411739cd287a6d5e998e121a8daca614df14a81a0dcac586",
  "unk_char.dat.gz": "9a8e86fd9aff32d323fbb59f5a7006f05927a11f8173c90712cc56293aeb3225",
  "unk_compat.dat.gz": "50f60aa29bc2e86c2903ab8c825bb6fa604d2b294d96941c1d3924259791899d",
  "unk_invoke.dat.gz": "6b210889548457c3006913afd12c8b525562255f2709e404604be9614a25e94c",
  "unk_map.dat.gz": "6df12460e5477230bb6fd9641def918b699fc0a8868016b6c9f794488630509b",
  "unk_pos.dat.gz": "5b183a29f281acc7e0542beca47b83f7985047c0a2d27e78a66f32276be5ad11",
  "unk.dat.gz": "f7f991cdeb9bfd3e9c0e4577cc50ee0815a11c508cccd444a9d3ab3c81521100",
};
const store = createLyricDictionaryStore({
  root,
  version,
  files,
  fetchFile: fetch,
});
export const { getLyricDictionaryStatus, downloadLyricDictionary } = store;
const worker = createLyricDictionaryWorker(path.join(root, version));
let removing = false;

/** 删除词典前关闭工作线程 */
export async function removeLyricDictionary() {
  removing = true;
  try {
    await worker.stop();
    return await store.removeLyricDictionary();
  } finally {
    removing = false;
  }
}

/**
 * 使用已安装词典优化歌词发音，保留正文与时序
 * @param lines - 原始歌词行
 * @returns 优化后的歌词行
 */
export async function optimizeWithJapaneseDictionary(lines: LyricLine[]): Promise<LyricLine[]> {
  const indexes: number[] = [];
  const texts: string[] = [];
  lines.forEach((line, index) => {
    const text = line.words.map((word) => word.word).join("");
    if (
      line.language === "ja" ||
      (line.language !== "ko" &&
        line.language !== "zh-CN" &&
        line.language !== "yue" &&
        /[\u3040-\u30ff]/u.test(text))
    ) {
      indexes.push(index);
      texts.push(text);
    }
  });
  if (!texts.length) return lines;
  if (removing || !(await store.getLyricDictionaryStatus()).installed || removing)
    throw new Error("日语离线词典尚未安装");
  const results = await worker.tokenize(texts);
  const output = lines.slice();
  indexes.forEach((index, position) => {
    output[index] = optimizeJapaneseLine(lines[index], { tokenize: () => results[position] });
  });
  return output;
}

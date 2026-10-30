import type { LyricLine } from "lyric-kit";

/** 发音优化方式，离线词典目前支持日语 */
export type PronunciationOptimization = "off" | "llm" | "dictionary";

/** 增强后的歌词行：在 lyric-kit 行类型上附加生成来源标记，原文与时序不改写 */
export interface EnhancedLyricLine extends LyricLine {
  /** 自动补充的翻译及目标语言 */
  generatedTranslation?: { method: "llm"; language: string };
  /** 自动补充或重新分词的发音 */
  generatedPronunciation?: { method: "llm" | "dictionary"; alignment?: "line" | "word" };
  /** 发音含显式分隔空格，提升为主文字时保留排版，渲染器不再自动补空格 */
  preserveRomanizationSpacing?: boolean;
}

/** 当前歌词版本的展示增强请求 */
export interface LyricEnhancementRequest {
  versionKey: string;
  locale: string;
  lines: LyricLine[];
  translate: boolean;
  pronunciation: PronunciationOptimization;
}

/** 本地词典状态 */
export interface LyricDictionaryStatus {
  installed: boolean;
  downloading: boolean;
  version: string;
}

/** 增强结果保留原歌词时序，只更新翻译和发音 */
export interface LyricEnhancementResult {
  lines: EnhancedLyricLine[];
  warnings: string[];
}

/** 歌词增强 IPC，仅主进程接触密钥、词典和磁盘缓存 */
export interface LyricEnhancementApi {
  enhance: (request: LyricEnhancementRequest) => Promise<LyricEnhancementResult>;
  dictionaryStatus: () => Promise<LyricDictionaryStatus>;
  downloadDictionary: () => Promise<LyricDictionaryStatus>;
  removeDictionary: () => Promise<LyricDictionaryStatus>;
  clearCache: () => Promise<void>;
}

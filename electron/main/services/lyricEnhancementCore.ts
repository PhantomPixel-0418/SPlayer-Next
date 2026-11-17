import type { LyricLine } from "@shared/types/lyrics";
import type { EnhancedLyricLine, PronunciationGranularity } from "@shared/types/lyricEnhancement";
import { hasRuby } from "../../../shared/utils/lyricEnhancement";

type Task = "translation" | "pronunciation" | "ruby";
export interface EnhancementPatch {
  id: number;
  translation?: string | null;
  romanWords?: string[] | null;
  /** 逐行发音增强产出的整行音译 */
  romanLyric?: string | null;
  ruby?: Record<string, string> | null;
}

/** 汉字文本 */
const HAN_TEXT = /\p{Script=Han}/u;

/** 假名或谚文文本，用于与汉字区分中日韩语言 */
const KANA_HANGUL_TEXT = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * 判断文本是否明显属于界面语言，无法判断时交给模型
 * @param text - 待识别文本
 * @param locale - 目标界面语言
 * @param language - 已知原文语言
 * @returns 是否明显匹配
 */
export const matchesLocale = (text: string, locale: string, language?: string): boolean => {
  const value = text.trim();
  if (!value) return false;
  if (locale.startsWith("zh")) {
    if (language === "zh-CN") return true;
    if (language || /[\u3040-\u30ff\uac00-\ud7af]/u.test(value)) return false;
    return (
      /[这为们说爱时过对还没让给吗呢]/u.test(value) ||
      /你好|謝謝|谢谢|我們|這個|什麼|沒有|為什麼/u.test(value)
    );
  }
  if (locale.startsWith("en")) {
    if (language && language !== "und-Latn") return false;
    if (!/^[a-z\d\p{Punctuation}\p{Separator}\s]+$/iu.test(value)) return false;
    const words = value.toLowerCase().match(/[a-z]+/g) ?? [];
    const signals = new Set([
      "the",
      "you",
      "your",
      "yourself",
      "myself",
      "we",
      "our",
      "with",
      "without",
      "this",
      "that",
      "what",
      "where",
      "when",
      "are",
      "were",
      "have",
      "will",
      "hello",
      "world",
      "love",
      "heart",
    ]);
    return words.filter((word) => signals.has(word)).length >= 2;
  }
  return false;
};

/**
 * 判断已有译文是否已属于目标语言，避免重复生成或覆盖人工译文
 * @param text - 已有译文
 * @param locale - 目标界面语言
 * @returns 是否已是可直接展示的目标语言译文
 */
export const hasLocaleTranslation = (text: string, locale: string): boolean => {
  const value = text.trim();
  if (!value) return false;
  if (locale.startsWith("zh")) return HAN_TEXT.test(value) && !KANA_HANGUL_TEXT.test(value);
  if (locale.startsWith("en"))
    return (
      /^[a-z\d\p{Punctuation}\p{Separator}\s]+$/iu.test(value) && /\p{Script=Latin}/u.test(value)
    );
  // 其他目标语言无法可靠判定，已有译文直接沿用
  return true;
};

/**
 * 严格校验模型返回的行标识、内容和原始片段数量
 * @param value - 待校验的行补丁
 * @param lines - 原始歌词
 * @param ids - 本次请求的行标识
 * @param task - 增强类型
 * @param granularity - 发音增强粒度，决定校验字段
 * @returns 校验后的补丁
 */
export const validateEnhancementPatch = (
  value: unknown,
  lines: LyricLine[],
  ids: number[],
  task: Task,
  granularity: PronunciationGranularity = "word",
): EnhancementPatch[] => {
  if (!Array.isArray(value) || value.length !== ids.length) throw new Error("invalid patch");
  const allowed = new Set(ids);
  const seen = new Set<number>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("invalid row");
    const row = entry as Record<string, unknown>;
    const id = row.id;
    if (!Number.isInteger(id) || !allowed.has(id as number) || seen.has(id as number))
      throw new Error("invalid id");
    seen.add(id as number);
    if (task === "translation") {
      if (
        row.translation !== null &&
        (typeof row.translation !== "string" ||
          !row.translation.trim() ||
          row.translation.length > 2000)
      )
        throw new Error("invalid translation");
      return { id: id as number, translation: row.translation as string | null };
    }
    if (task === "ruby") {
      const readings = row.ruby;
      if (readings !== null) {
        if (!readings || typeof readings !== "object" || Array.isArray(readings))
          throw new Error("invalid ruby");
        const entries = Object.entries(readings as Record<string, unknown>);
        if (!entries.length) throw new Error("invalid ruby");
        for (const [key, value] of entries) {
          const index = Number(key);
          if (
            !/^\d+$/.test(key) ||
            !Number.isInteger(index) ||
            index >= lines[id as number].words.length ||
            typeof value !== "string" ||
            !value.trim() ||
            value.length > 64
          )
            throw new Error("invalid ruby");
        }
      }
      return { id: id as number, ruby: readings as Record<string, string> | null };
    }
    return validatePronunciationRow(row, id as number, lines[id as number], granularity);
  });
};
/**
 * 校验发音补丁行，逐字粒度要求按词对齐的 romanWords，逐行粒度要求整行 romanLyric
 * @param row - 模型返回的行补丁
 * @param id - 行标识
 * @param line - 原始歌词行
 * @param granularity - 增强粒度
 * @returns 校验后的补丁行
 */
const validatePronunciationRow = (
  row: Record<string, unknown>,
  id: number,
  line: LyricLine,
  granularity: PronunciationGranularity,
): EnhancementPatch => {
  if (granularity === "line") {
    const reading = row.romanLyric;
    if (
      reading !== null &&
      (typeof reading !== "string" || !reading.trim() || reading.length > 2000)
    )
      throw new Error("invalid pronunciation");
    return { id, romanLyric: reading as string | null };
  }
  const words = row.romanWords;
  if (
    words !== null &&
    (!Array.isArray(words) ||
      words.length !== line.words.length ||
      !words.some((word: unknown) => typeof word === "string" && word.trim()) ||
      words.some(
        (word: unknown, index: number) =>
          typeof word !== "string" ||
          word.length > 500 ||
          (/[\p{Letter}\p{Number}]/u.test(line.words[index].word) && !word.trim()),
      ))
  )
    throw new Error("invalid pronunciation");
  return { id, romanWords: words as string[] | null };
};

/**
 * 将经过校验的补丁应用到副本，不修改原文与时序
 * @param lines - 原始歌词
 * @param patch - 已校验的补丁
 * @param task - 增强类型
 * @param locale - 目标界面语言
 * @returns 应用补丁后的歌词
 */
export const applyEnhancementPatch = (
  lines: EnhancedLyricLine[],
  patch: EnhancementPatch[],
  task: Task,
  locale: string,
): EnhancedLyricLine[] => {
  const output = lines.slice();
  for (const row of patch) {
    const line = output[row.id];
    if (task === "translation" && row.translation) {
      output[row.id] = {
        ...line,
        translatedLyric: row.translation,
        generatedTranslation: { method: "llm", language: locale },
      };
    } else if (task === "pronunciation" && row.romanWords) {
      output[row.id] = {
        ...line,
        words: line.words.map((word, index) => ({ ...word, romanWord: row.romanWords![index] })),
        romanLyric: row.romanWords.join(""),
        preserveRomanizationSpacing: true,
        generatedPronunciation: { method: "llm" },
      };
    } else if (task === "pronunciation" && row.romanLyric) {
      output[row.id] = {
        ...line,
        romanLyric: row.romanLyric,
        generatedPronunciation: { method: "llm" },
      };
    } else if (task === "ruby" && row.ruby) {
      const readings = row.ruby;
      // 索引键规范化：允许模型按位宽补零（如 "00"），按整数索引归一化再读取，避免零填充键被静默丢弃
      const readingsByIndex = new Map<number, string>();
      for (const [key, value] of Object.entries(readings)) {
        const index = Number(key);
        if (
          Number.isInteger(index) &&
          index >= 0 &&
          index < line.words.length &&
          typeof value === "string" &&
          value.trim()
        )
          readingsByIndex.set(index, value.trim());
      }
      output[row.id] = {
        ...line,
        words: line.words.map((word, index) => {
          const reading = readingsByIndex.get(index);
          // 与行选择共用同一有效注音判定，空白注音视为缺失并采用模型结果
          return reading && !hasRuby(word)
            ? {
                ...word,
                ruby: [{ word: reading, startTime: word.startTime, endTime: word.endTime }],
              }
            : word;
        }),
        generatedRuby: { method: "llm" },
      };
    }
  }
  return output;
};

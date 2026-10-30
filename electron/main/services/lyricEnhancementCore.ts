import type { LyricLine } from "@shared/types/lyrics";

type Task = "translation" | "pronunciation";
export interface EnhancementPatch {
  id: number;
  translation?: string | null;
  romanWords?: string[] | null;
}

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
 * 严格校验模型返回的行标识、内容和原始片段数量
 * @param value - 待校验的行补丁
 * @param lines - 原始歌词
 * @param ids - 本次请求的行标识
 * @param task - 增强类型
 * @returns 校验后的补丁
 */
export const validateEnhancementPatch = (
  value: unknown,
  lines: LyricLine[],
  ids: number[],
  task: Task,
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
    const words = row.romanWords;
    if (
      words !== null &&
      (!Array.isArray(words) ||
        words.length !== lines[id as number].words.length ||
        !words.some((word: unknown) => typeof word === "string" && word.trim()) ||
        words.some(
          (word: unknown, index: number) =>
            typeof word !== "string" ||
            word.length > 500 ||
            (/[\p{Letter}\p{Number}]/u.test(lines[id as number].words[index].word) && !word.trim()),
        ))
    )
      throw new Error("invalid pronunciation");
    return { id: id as number, romanWords: words as string[] | null };
  });
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
  lines: LyricLine[],
  patch: EnhancementPatch[],
  task: Task,
  locale: string,
): LyricLine[] => {
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
    }
  }
  return output;
};

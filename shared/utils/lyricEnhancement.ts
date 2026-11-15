import type { LyricWord } from "lyric-kit";
import type { EnhancedLyricLine } from "@shared/types/lyricEnhancement";

/** 需要音译的 CJK 文本 */
const PRONUNCIATION_TEXT = /[぀-ヿ㐀-鿿가-힯]/u;

/** 需要假名注音的汉字 */
const HAN_TEXT = /[㐀-鿿豈-﫿]/u;

/** 实义词，纯标点不计入已有发音的覆盖 */
const MEANINGFUL_TEXT = /[\p{L}\p{N}]/u;

/** 判断词内注音是否含有效假名 */
const hasRuby = (word: LyricWord): boolean => !!word.ruby?.some((span) => span.word?.trim());

/**
 * 判断一行是否还需要 LLM 补充发音
 * @param line - 已解析或已增强的歌词行
 * @returns 是否需要生成
 */
export const needsPronunciation = (line: EnhancedLyricLine): boolean => {
  const text = line.words.map((word) => word.word).join("");
  if (!PRONUNCIATION_TEXT.test(text)) return false;
  if (line.generatedPronunciation || line.romanLyric.trim()) return false;
  const meaningful = line.words.filter((word) => MEANINGFUL_TEXT.test(word.word));
  // 歌词自带完整逐字音译时，逐行粒度也不必再生成整行音译
  if (meaningful.length && meaningful.every((word) => word.romanWord?.trim())) return false;
  return true;
};

/**
 * 判断一行是否还需要 LLM 补充假名注音
 * @param line - 已解析或已增强的歌词行
 * @returns 是否需要生成
 */
export const needsRuby = (line: EnhancedLyricLine): boolean => {
  if (line.language !== "ja" || line.generatedRuby) return false;
  // 假名与标点本就无需注音，只按汉字词的实际 ruby 字段判断，不按歌词格式推断
  const hanWords = line.words.filter((word) => HAN_TEXT.test(word.word));
  return hanWords.some((word) => !hasRuby(word));
};

/**
 * 选出仍需 LLM 补充发音与注音的行标识
 * @param lines - 已解析的歌词行
 * @param pronunciation - 是否启用发音增强
 * @param ruby - 是否启用注音增强
 * @returns 待增强的行标识
 */
export const selectPronunciationAndRubyIds = (
  lines: EnhancedLyricLine[],
  pronunciation: boolean,
  ruby: boolean,
): { pronunciationIds: number[]; rubyIds: number[] } => ({
  pronunciationIds: pronunciation
    ? lines.flatMap((line, id) => (needsPronunciation(line) ? [id] : []))
    : [],
  rubyIds: ruby ? lines.flatMap((line, id) => (needsRuby(line) ? [id] : [])) : [],
});

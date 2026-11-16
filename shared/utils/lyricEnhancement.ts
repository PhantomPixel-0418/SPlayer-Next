import type { LyricWord } from "lyric-kit";
import type { EnhancedLyricLine, PronunciationGranularity } from "@shared/types/lyricEnhancement";

/** 需要音译的 CJK 文本，含扩展区汉字（粤语等方言用字）与谚文 */
const PRONUNCIATION_TEXT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** 需要假名注音的汉字 */
const HAN_TEXT = /[㐀-鿿豈-﫿]/u;

/** 实义词，纯标点不计入已有发音的覆盖 */
const MEANINGFUL_TEXT = /[\p{L}\p{N}]/u;

/**
 * 判断词内注音是否含有效假名
 * @param word - 待判断的歌词词
 * @returns 是否存在非空白注音
 */
export const hasRuby = (word: LyricWord): boolean => !!word.ruby?.some((span) => span.word?.trim());

/**
 * 判断一行是否还需要 LLM 补充发音
 * @param line - 已解析或已增强的歌词行
 * @param granularity - 发音增强粒度
 * @returns 是否需要生成
 */
export const needsPronunciation = (
  line: EnhancedLyricLine,
  granularity: PronunciationGranularity,
): boolean => {
  const text = line.words.map((word) => word.word).join("");
  if (!PRONUNCIATION_TEXT.test(text)) return false;
  if (line.generatedPronunciation) return false;
  // 逐行粒度已有整行音译即可展示，逐字粒度仍需补齐缺失的逐词音译
  if (granularity === "line" && line.romanLyric.trim()) return false;
  const meaningful = line.words.filter((word) => MEANINGFUL_TEXT.test(word.word));
  // 歌词自带完整逐字音译时，两种粒度都无需再生成
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
 * @param granularity - 发音增强粒度
 * @param ruby - 是否启用注音增强
 * @returns 待增强的行标识
 */
export const selectPronunciationAndRubyIds = (
  lines: EnhancedLyricLine[],
  pronunciation: boolean,
  granularity: PronunciationGranularity,
  ruby: boolean,
): { pronunciationIds: number[]; rubyIds: number[] } => ({
  pronunciationIds: pronunciation
    ? lines.flatMap((line, id) => (needsPronunciation(line, granularity) ? [id] : []))
    : [],
  rubyIds: ruby ? lines.flatMap((line, id) => (needsRuby(line) ? [id] : [])) : [],
});

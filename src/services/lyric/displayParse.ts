import type { LyricInput, LyricLine } from "lyric-kit";
import type { LyricData } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";

import {
  applyLyricLanguages,
  applyTimestampOffset,
  clampLastLineEnd,
  extractLyricAuthors,
  normalizeLyricLines,
  parseLyric,
} from "lyric-kit";
import { applyLyricExclude } from "@/utils/lyric/lyricStripper";
import { useSettingsStore } from "@/stores/settings";

/**
 * 把歌词源解析成可展示的逐字时间轴，切歌提交与预载预热共用同一管线，保证结果逐字节一致
 * @param source - 非空歌词源
 * @param input - 歌词内容
 * @param track - 用于排除与末行时长约束的曲目
 * @returns 解析后的行、作者列表与是否具备逐字时间
 */
export const parseLyricForDisplay = ({
  source,
  input,
  track,
}: {
  source: NonNullable<LyricData>;
  input: LyricInput;
  track: Track | null;
}): { lines: LyricLine[]; authors: string[]; hasWordTiming: boolean } => {
  const settings = useSettingsStore();
  const result = parseLyric(
    {
      content: input.content,
      format: source.format,
      translation: input.translation,
      translationFormat: input.translationFormat,
      romaji: input.romaji,
      romajiFormat: input.romajiFormat,
    },
    {
      detectBackground: settings.lyric.detectBackgroundLyrics,
      preferredLang: settings.locale,
      cleanKangxi: true,
      extractMetadata: true,
    },
  );
  if (source.timeShiftMs) applyTimestampOffset(result.lines, source.timeShiftMs);
  const excluded = applyLyricExclude(result.lines, track);
  normalizeLyricLines(excluded);
  const lines = clampLastLineEnd(excluded, track?.duration);
  let hasWordTiming = false;
  const segmenter = settings.lyric.autoGenerateWordByWord
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
  for (const line of lines) {
    const timed =
      (line.words.length > 1 || ["ttml", "lys", "yrc", "qrc", "krc"].includes(source.format)) &&
      line.words.some((word) => word.endTime > word.startTime);
    if (timed) {
      hasWordTiming = true;
      continue;
    }
    if (!segmenter || line.endTime <= line.startTime) continue;
    const text = line.words.map((word) => word.word).join("");
    const characters = Array.from(segmenter.segment(text), (part) => part.segment);
    if (!characters.length) continue;
    const duration = line.endTime - line.startTime;
    line.words = characters.map((word, index) => ({
      word,
      startTime: line.startTime + Math.round((duration * index) / characters.length),
      endTime: line.startTime + Math.round((duration * (index + 1)) / characters.length),
    }));
    hasWordTiming = true;
  }
  applyLyricLanguages(lines);
  const authors = result.metadata.authors?.length
    ? result.metadata.authors
    : extractLyricAuthors(input.content, source.format);
  return { lines, authors, hasWordTiming };
};

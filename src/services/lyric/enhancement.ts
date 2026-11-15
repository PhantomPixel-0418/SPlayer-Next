import type { LyricData, LyricLine } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import type { LyricEnhancementRequest } from "@shared/types/lyricEnhancement";

/**
 * 创建只针对当前歌曲及歌词版本的展示增强请求
 * @param lines - 未转换的解析歌词
 * @param source - 当前选择的歌词版本
 * @param track - 当前曲目及媒体服务器身份
 * @param locale - 目标界面语言
 * @param translate - 是否补充翻译
 * @param pronunciation - 是否补充发音
 * @param ruby - 是否补充注音（日语假名）
 * @returns 关闭所有增强时返回 null
 */
export const buildLyricEnhancementRequest = (
  lines: LyricLine[],
  source: LyricData,
  track: Track | null,
  locale: string,
  translate: boolean,
  pronunciation: boolean,
  ruby: boolean,
): LyricEnhancementRequest | null => {
  if (!source || !lines.length) return null;
  // TTML 歌词自带官方译文，跳过机器翻译，仅保留发音增强
  const shouldTranslate = translate === true && source.format !== "ttml";
  if (!shouldTranslate && !pronunciation && !ruby) return null;
  return {
    versionKey: JSON.stringify([
      track?.source,
      track?.serverId,
      track?.serverRevision,
      track?.id,
      source.source,
      source.platform,
      source.format,
    ]),
    locale,
    lines,
    translate: shouldTranslate,
    pronunciation,
    ruby,
  };
};

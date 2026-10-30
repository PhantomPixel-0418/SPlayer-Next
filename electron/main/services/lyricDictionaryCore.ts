import { toKatakana, toRomaji } from "wanakana";
import type { IpadicFeatures } from "kuromoji";
import type { LyricLine } from "@shared/types/lyrics";

type DictionaryToken = Pick<IpadicFeatures, "surface_form" | "reading"> &
  Partial<Pick<IpadicFeatures, "pos" | "pos_detail_1" | "conjugated_form">>;

/**
 * 获取分词的实际读音，修正语法助词的特殊读法
 * @param token - 日语词典分词
 * @returns 假名读音，无读音时返回空字符串
 */
function tokenReading(token: DictionaryToken): string {
  if (token.pos === "助詞") {
    if (token.surface_form === "は") return "ワ";
    if (token.surface_form === "へ") return "エ";
    if (token.surface_form === "を") return "オ";
  }
  return (
    token.reading ?? (/^[\u3040-\u30ffー]+$/u.test(token.surface_form) ? token.surface_form : "")
  );
}

/**
 * 判断相邻词素是否需要词间空格
 * @param previous - 前一个词素
 * @param token - 当前词素
 * @param gap - 原文词素之间的内容
 * @returns 是否插入空格
 */
function needsWordSpace(
  previous: DictionaryToken | undefined,
  token: DictionaryToken,
  gap: string,
): boolean {
  if (!previous) return false;
  if (/\s/u.test(gap)) return true;
  if (
    token.pos === "助動詞" ||
    token.pos_detail_1 === "接尾" ||
    (token.pos === "動詞" && token.pos_detail_1 === "非自立")
  )
    return false;
  if (
    token.pos === "助詞" &&
    token.pos_detail_1 === "接続助詞" &&
    /^[てで]$/u.test(token.surface_form) &&
    (previous.pos === "動詞" || previous.pos === "形容詞" || previous.pos === "助動詞")
  )
    return false;
  return true;
}

/**
 * 按词典词边界和原片段边界生成日语发音
 * @param line - 原始歌词行
 * @param tokenizer - 日语分词器
 * @returns 保留原时序的歌词行
 */
export function optimizeJapaneseLine(
  line: LyricLine,
  tokenizer: {
    tokenize: (text: string) => DictionaryToken[];
  },
): LyricLine {
  const text = line.words.map((word) => word.word).join("");
  if (
    line.language !== "ja" &&
    (line.language === "ko" ||
      line.language === "zh-CN" ||
      line.language === "yue" ||
      !/[\u3040-\u30ff]/u.test(text))
  )
    return line;
  const tokens = tokenizer.tokenize(text);
  let wholeLine = "";
  let wholeCursor = 0;
  let validWholeLine = true;
  let previousWhole: DictionaryToken | undefined;
  for (const token of tokens) {
    if (/^\s+$/u.test(token.surface_form)) continue;
    const start = text.indexOf(token.surface_form, wholeCursor);
    if (start < wholeCursor || text.slice(wholeCursor, start).trim()) {
      validWholeLine = false;
      break;
    }
    const reading = tokenReading(token);
    if (reading)
      wholeLine +=
        (needsWordSpace(previousWhole, token, text.slice(wholeCursor, start)) ? " " : "") +
        toRomaji(reading);
    else if (/^[\p{P}\p{S}\s]+$/u.test(token.surface_form)) wholeLine += token.surface_form.trim();
    else {
      validWholeLine = false;
      break;
    }
    wholeCursor = start + token.surface_form.length;
    previousWhole = token;
  }
  if (text.slice(wholeCursor).trim()) validWholeLine = false;
  const fallback: LyricLine =
    validWholeLine && wholeLine
      ? {
          ...line,
          words: line.words.map((word) => {
            const copy = { ...word };
            delete copy.romanWord;
            return copy;
          }),
          romanLyric: wholeLine,
          generatedPronunciation: { method: "dictionary", alignment: "line" },
        }
      : line;
  const output = line.words.map(() => "");
  const ranges: { start: number; end: number }[] = [];
  let offset = 0;
  for (const word of line.words) {
    ranges.push({ start: offset, end: offset + word.word.length });
    offset += word.word.length;
  }
  let cursor = 0;
  let hasPronunciation = false;
  let previousToken: DictionaryToken | undefined;
  for (const token of tokens) {
    if (/^\s+$/u.test(token.surface_form)) continue;
    const start = text.indexOf(token.surface_form, cursor);
    if (start < cursor || text.slice(cursor, start).trim()) return fallback;
    const end = start + token.surface_form.length;
    const intersections = ranges.flatMap((range, index) => {
      const a = Math.max(start, range.start);
      const b = Math.min(end, range.end);
      return a < b ? [{ index, a, b, part: text.slice(a, b) }] : [];
    });
    if (!intersections.length) return fallback;
    const reading = tokenReading(token);
    if (!reading) {
      if (/^[\p{P}\p{S}\s]+$/u.test(token.surface_form)) {
        for (const part of intersections) output[part.index] += part.part;
        cursor = end;
        previousToken = token;
        continue;
      }
      return fallback;
    }
    const roman = toRomaji(reading);
    let pieces: string[];
    if (intersections.length === 1) {
      pieces = [roman];
    } else if (
      toKatakana(token.surface_form) === toKatakana(reading) &&
      /^[\u3040-\u30ffー]+$/u.test(token.surface_form)
    ) {
      let previous = 0;
      pieces = intersections.map((part, index) => {
        let prefix = toRomaji(token.surface_form.slice(0, part.b - start));
        const next = intersections[index + 1]?.part;
        if (part.part.endsWith("っ") || part.part.endsWith("ッ")) {
          const consonant = next && toRomaji(next).match(/^[bcdfghjklmnpqrstvwxyz]/i)?.[0];
          if (consonant) prefix += consonant;
        }
        if (!roman.startsWith(prefix) || prefix.length < previous) return "";
        const result = roman.slice(previous, prefix.length);
        previous = prefix.length;
        return result;
      });
      if (pieces.some((part) => !part) || pieces.join("") !== roman) return fallback;
    } else if (
      intersections.filter(({ part }) => /[\p{Script=Han}]/u.test(part)).length === 1 &&
      intersections.every(({ part }) => /^[\p{Script=Han}\u3040-\u30ffー]+$/u.test(part))
    ) {
      const unknown = intersections.findIndex(({ part }) => /[\p{Script=Han}]/u.test(part));
      const part = intersections[unknown].part;
      const matched = /^([\u3040-\u30ffー]*)([\p{Script=Han}]+)([\u3040-\u30ffー]*)$/u.exec(part);
      if (!matched) return fallback;
      const before = toKatakana(
        intersections
          .slice(0, unknown)
          .map((item) => item.part)
          .join("") + matched[1],
      );
      const after = toKatakana(
        matched[3] +
          intersections
            .slice(unknown + 1)
            .map((item) => item.part)
            .join(""),
      );
      const kana = toKatakana(reading);
      if (
        !kana.startsWith(before) ||
        !kana.endsWith(after) ||
        before.length + after.length >= kana.length
      )
        return fallback;
      const unknownReading = kana.slice(before.length, kana.length - after.length);
      pieces = intersections.map(({ part: value }, index) =>
        toRomaji(index === unknown ? matched[1] + unknownReading + matched[3] : value),
      );
      if (pieces.some((value) => !value) || pieces.join("") !== roman) return fallback;
    } else {
      if (
        intersections.some(
          ({ index, a, b }) => a !== ranges[index].start || b !== ranges[index].end,
        )
      )
        return fallback;
      pieces = intersections.map(({ index }) =>
        (line.words[index].romanWord ?? "").replace(/\s+/gu, ""),
      );
      if (pieces.some((part) => !part) || pieces.join("").toLowerCase() !== roman.toLowerCase())
        return fallback;
    }
    const separator = needsWordSpace(previousToken, token, text.slice(cursor, start)) ? " " : "";
    intersections.forEach((part, index) => {
      output[part.index] += (index === 0 ? separator : "") + pieces[index];
    });
    hasPronunciation = true;
    cursor = end;
    previousToken = token;
  }
  if (!hasPronunciation || text.slice(cursor).trim()) return fallback;
  return {
    ...line,
    words: line.words.map((word, index) => ({ ...word, romanWord: output[index] })),
    romanLyric: output.join(""),
    preserveRomanizationSpacing: true,
    generatedPronunciation: { method: "dictionary", alignment: "word" },
  };
}

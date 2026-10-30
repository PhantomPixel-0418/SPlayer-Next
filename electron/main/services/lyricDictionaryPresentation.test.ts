import assert from "node:assert/strict";
import test from "node:test";
import kuromoji from "kuromoji";
import type { LyricLine } from "@shared/types/lyrics";
import { optimizeJapaneseLine } from "./lyricDictionaryCore";
import {
  promoteDefaultPronunciation,
  promotePronunciation,
} from "../../../src/components/player/Lyrics/romanization";

const tokenizer = await new Promise<
  import("kuromoji").Tokenizer<import("kuromoji").IpadicFeatures>
>((resolve, reject) => {
  kuromoji
    .builder({ dicPath: "node_modules/kuromoji/dict" })
    .build((error, result) => (error ? reject(error) : resolve(result)));
});

/**
 * 创建可区分时间的逐拍歌词
 * @param parts - 原文片段
 * @param readings - 原始逐片段发音
 * @returns 歌词行
 */
function line(parts: string[], readings: string[] = []): LyricLine {
  return {
    language: "ja",
    words: parts.map((word, index) => ({
      word,
      startTime: index * 125,
      endTime: index * 125 + 100,
      ...(readings[index] === undefined ? {} : { romanWord: readings[index] }),
    })),
    translatedLyric: "",
    romanLyric: "",
    startTime: 0,
    endTime: parts.length * 125,
    isBG: false,
    isDuet: false,
  };
}

/**
 * 断言发音提升后的片段数、时间和拼接文本
 * @param source - 原歌词
 * @param output - 发音提升后的歌词
 * @param expected - 拼接后的发音
 */
function assertPromoted(source: LyricLine, output: LyricLine, expected: string): void {
  assert.equal(output.words.length, source.words.length);
  assert.deepEqual(
    output.words.map(({ startTime, endTime }) => [startTime, endTime]),
    source.words.map(({ startTime, endTime }) => [startTime, endTime]),
  );
  assert.equal(output.words.map(({ word }) => word).join(""), expected);
}

test("多拍词经两种播放器提升路径仍保留词内连续发音和时间", () => {
  const input = line(["に", "ち", "ら", "ば", "る", "言葉"]);
  const optimized = optimizeJapaneseLine(input, tokenizer);
  assert.deepEqual(
    optimized.words.map(({ romanWord }) => romanWord),
    ["ni", " chi", "ra", "ba", "ru", " kotoba"],
  );
  assert.equal(optimized.preserveRomanizationSpacing, true);
  assertPromoted(input, promotePronunciation(optimized, "word"), "ni chirabaru kotoba");
  assertPromoted(input, promoteDefaultPronunciation([optimized], false)[0], "ni chirabaru kotoba");
  assertPromoted(input, promotePronunciation(optimized, "word", true), "ni chi ra ba ru kotoba");
  assertPromoted(
    input,
    promoteDefaultPronunciation([optimized], false, true)[0],
    "ni chi ra ba ru kotoba",
  );
});

test("已有汉字片段读音与词典一致时拼成词语，词边界留空格", () => {
  const input = line(["足", "元", "に"], [" ashi ", " moto ", " ni "]);
  const optimized = optimizeJapaneseLine(input, tokenizer);
  assert.deepEqual(
    optimized.words.map(({ romanWord }) => romanWord),
    ["ashi", "moto", " ni"],
  );
  assertPromoted(input, promotePronunciation(optimized, "word"), "ashimoto ni");
  assertPromoted(input, promoteDefaultPronunciation([optimized], false)[0], "ashimoto ni");
});

test("促音可保留独立时间片且拼接成完整词", () => {
  const input = line(["ず", "っ", "と", "言葉"]);
  const optimized = optimizeJapaneseLine(input, tokenizer);
  assert.deepEqual(
    optimized.words.map(({ romanWord }) => romanWord),
    ["zu", "t", "to", " kotoba"],
  );
  assert.equal(optimized.generatedPronunciation?.alignment, "word");
  assertPromoted(input, promotePronunciation(optimized, "word"), "zutto kotoba");
  assertPromoted(input, promoteDefaultPronunciation([optimized], false)[0], "zutto kotoba");
});

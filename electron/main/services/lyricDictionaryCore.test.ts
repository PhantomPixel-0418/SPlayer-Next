import assert from "node:assert/strict";
import test from "node:test";
import kuromoji from "kuromoji";
import { optimizeJapaneseLine } from "./lyricDictionaryCore";
import type { LyricLine } from "@shared/types/lyrics";

const tokenizer = await new Promise<
  import("kuromoji").Tokenizer<import("kuromoji").IpadicFeatures>
>((resolve, reject) => {
  kuromoji
    .builder({ dicPath: "node_modules/kuromoji/dict" })
    .build((error, result) => (error ? reject(error) : resolve(result)));
});

/**
 * 创建含逐片段时间的歌词
 * @param parts - 原文片段
 * @param roman - 原有发音
 * @returns 歌词行
 */
function line(parts: string[], roman: string[] = []): LyricLine {
  return {
    language: "ja",
    words: parts.map((word, index) => ({
      word,
      startTime: index * 100,
      endTime: index * 100 + 90,
      ...(roman[index] === undefined ? {} : { romanWord: roman[index] }),
    })),
    translatedLyric: "",
    romanLyric: "",
    startTime: 0,
    endTime: parts.length * 100,
    isBG: false,
    isDuet: false,
  };
}

test("按词语重排逐拍、连写和混乱空格并补全缺失发音", () => {
  const cases = [
    [
      line(
        ["ず", "っ", "と", "前", "の", "気持ち"],
        ["zu ", "t ", "to ", "mae ", "no ", "kimochi"],
      ),
      "zutto mae no kimochi",
    ],
    [
      line(["捨", "て", "切", "れ", "な", "く", "て"], ["su", "te", "ki", "re", "na", "ku", "te"]),
      "sutekirenakute",
    ],
    [
      line(
        ["足元", "に", "散", "ら", "ば", "る", "言葉"],
        ["  ashimoto", "ni  ", "chi ", "ra", " ba", "ru", "kotoba"],
      ),
      "ashimoto ni chirabaru kotoba",
    ],
    [line(["ずっと前の気持ち"]), "zutto mae no kimochi"],
  ] as const;
  for (const [input, expected] of cases) {
    const result = optimizeJapaneseLine(input, tokenizer);
    assert.equal(result.words.map((word) => word.romanWord).join(""), expected);
    assert.deepEqual(
      result.words.map(({ word, startTime, endTime }) => ({ word, startTime, endTime })),
      input.words.map(({ word, startTime, endTime }) => ({ word, startTime, endTime })),
    );
    assert.deepEqual(result.generatedPronunciation, { method: "dictionary", alignment: "word" });
  }
});

test("无法确定汉字片段读音时保留原行及其他语言", () => {
  const ambiguous = line(["足", "元", "に"], ["ash", "wrong", "ni"]);
  const original = structuredClone(ambiguous);
  const result = optimizeJapaneseLine(ambiguous, tokenizer);
  assert.equal(result.romanLyric, "ashimoto ni");
  assert.deepEqual(ambiguous, original);
  assert.ok(result.words.every((word) => word.romanWord === undefined));
  assert.deepEqual(
    result.words.map(({ word, startTime, endTime }) => ({ word, startTime, endTime })),
    ambiguous.words.map(({ word, startTime, endTime }) => ({ word, startTime, endTime })),
  );
  assert.deepEqual(result.generatedPronunciation, { method: "dictionary", alignment: "line" });
  const missing = line(["足", "元", "に", "散", "ら", "ば", "る", "言", "葉"]);
  const fallback = optimizeJapaneseLine(missing, tokenizer);
  assert.equal(fallback.romanLyric, "ashimoto ni chirabaru kotoba");
  assert.deepEqual(fallback.words, missing.words);
  assert.deepEqual(fallback.generatedPronunciation, { method: "dictionary", alignment: "line" });
  const chinese = { ...line(["中文"], ["zhong wen"]), language: "zh-CN" as const };
  assert.equal(optimizeJapaneseLine(chinese, tokenizer), chinese);
});

test("活用词素连写，助词按实际读音分隔，原文空格保持分词", () => {
  const cases = [
    ["捨て切れなくて", "sutekirenakute"],
    ["食べている", "tabeteiru"],
    ["私は君へ愛を", "watashi wa kimi e ai o"],
    ["捨て 切れなくて", "sute kirenakute"],
  ] as const;
  for (const [text, expected] of cases) {
    const input = line([text]);
    const output = optimizeJapaneseLine(input, tokenizer);
    assert.equal(output.romanLyric, expected);
    assert.equal(output.words[0].romanWord, expected);
    assert.equal(output.generatedPronunciation?.alignment, "word");
  }
  const input = line(["足", "元", "に", "捨", "て", "切", "れ", "な", "く", "て"]);
  const fallback = optimizeJapaneseLine(input, tokenizer);
  assert.equal(fallback.romanLyric, "ashimoto ni sutekirenakute");
  assert.equal(fallback.generatedPronunciation?.alignment, "line");
});

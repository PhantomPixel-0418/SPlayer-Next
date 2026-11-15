import { test } from "node:test";
import assert from "node:assert/strict";
import type { LyricLine } from "@shared/types/lyrics";
import {
  applyEnhancementPatch,
  matchesLocale,
  validateEnhancementPatch,
} from "./lyricEnhancementCore";

const lines: LyricLine[] = [
  {
    words: [
      { word: "君", startTime: 0, endTime: 1 },
      { word: "は", startTime: 1, endTime: 2 },
    ],
    translatedLyric: "",
    romanLyric: "",
    startTime: 0,
    endTime: 2,
    isBG: false,
    isDuet: false,
  },
];

test("严格校验行覆盖和发音片段数量", () => {
  assert.throws(() =>
    validateEnhancementPatch([{ id: 0, romanWords: ["kimi"] }], lines, [0], "pronunciation"),
  );
  assert.throws(() =>
    validateEnhancementPatch([{ id: 0, romanWords: ["kimi", ""] }], lines, [0], "pronunciation"),
  );
  assert.throws(() =>
    validateEnhancementPatch([{ id: 1, romanWords: ["kimi", "wa"] }], lines, [0], "pronunciation"),
  );
  assert.throws(() => validateEnhancementPatch([], lines, [0], "translation"));
  assert.throws(() =>
    validateEnhancementPatch([{ id: 0, translation: "" }], lines, [0], "translation"),
  );
  assert.throws(() => validateEnhancementPatch([{ id: 0, ruby: ["きみ"] }], lines, [0], "ruby"));
  assert.throws(() => validateEnhancementPatch([{ id: 0, ruby: {} }], lines, [0], "ruby"));
  assert.throws(() =>
    validateEnhancementPatch([{ id: 0, ruby: { "2": "きみ" } }], lines, [0], "ruby"),
  );
  assert.throws(() => validateEnhancementPatch([{ id: 0, ruby: { "0": "" } }], lines, [0], "ruby"));
});

test("逐行发音粒度校验整行音译", () => {
  assert.throws(() =>
    validateEnhancementPatch([{ id: 0, romanLyric: "" }], lines, [0], "pronunciation", "line"),
  );
  assert.throws(() =>
    validateEnhancementPatch(
      [{ id: 0, romanLyric: "x".repeat(2001) }],
      lines,
      [0],
      "pronunciation",
      "line",
    ),
  );
  const patch = validateEnhancementPatch(
    [{ id: 0, romanLyric: "kimi wa" }],
    lines,
    [0],
    "pronunciation",
    "line",
  );
  const updated = applyEnhancementPatch(lines, patch, "pronunciation", "zh-CN");
  assert.equal(updated[0].romanLyric, "kimi wa");
  assert.equal(updated[0].words[0].romanWord, undefined);
  assert.equal(updated[0].generatedPronunciation?.method, "llm");
});

test("补丁保留原始歌词和时间，写入生成标记", () => {
  const patch = validateEnhancementPatch(
    [{ id: 0, romanWords: ["kimi ", "wa"] }],
    lines,
    [0],
    "pronunciation",
  );
  const updated = applyEnhancementPatch(lines, patch, "pronunciation", "zh-CN");
  assert.equal(updated[0].words[0].word, "君");
  assert.equal(updated[0].words[1].startTime, 1);
  assert.equal(updated[0].romanLyric, "kimi wa");
  assert.equal(updated[0].generatedPronunciation?.method, "llm");
  assert.equal(lines[0].words[0].romanWord, undefined);
});

test("零填充注音键按整数索引归一化，不丢数据", () => {
  const patch = validateEnhancementPatch(
    [{ id: 0, ruby: { "00": "きみ", "01": "わ" } }],
    lines,
    [0],
    "ruby",
  );
  const updated = applyEnhancementPatch(lines, patch, "ruby", "zh-CN");
  assert.deepEqual(updated[0].words[0].ruby, [{ word: "きみ", startTime: 0, endTime: 1 }]);
  assert.deepEqual(updated[0].words[1].ruby, [{ word: "わ", startTime: 1, endTime: 2 }]);
  assert.equal(updated[0].generatedRuby?.method, "llm");
});

test("注音补丁写入假名并保留已有注音", () => {
  const annotated = lines.map((line) => ({
    ...line,
    words: line.words.map((word, index) =>
      index === 0 ? { ...word, ruby: [{ word: "きみ", startTime: 0, endTime: 1 }] } : word,
    ),
  }));
  const patch = validateEnhancementPatch(
    [{ id: 0, ruby: { "0": "きみ", "1": "わ" } }],
    annotated,
    [0],
    "ruby",
  );
  const updated = applyEnhancementPatch(annotated, patch, "ruby", "zh-CN");
  assert.deepEqual(updated[0].words[0].ruby, [{ word: "きみ", startTime: 0, endTime: 1 }]);
  assert.deepEqual(updated[0].words[1].ruby, [{ word: "わ", startTime: 1, endTime: 2 }]);
  assert.equal(updated[0].generatedRuby?.method, "llm");
  assert.equal(lines[0].words[0].ruby, undefined);
});

test("识别明确的界面语言，避免覆盖已有翻译", () => {
  assert.equal(matchesLocale("你好", "zh-CN"), true);
  assert.equal(matchesLocale("Hello world", "en-US"), true);
  assert.equal(matchesLocale("こんにちは", "zh-CN", "ja"), false);
  assert.equal(matchesLocale("繁體中文", "zh-CN", "zh-CN"), true);
  assert.equal(matchesLocale("東京", "zh-CN", "ja"), false);
  assert.equal(matchesLocale("東京", "zh-CN", "und-Hani"), false);
  assert.equal(matchesLocale("東京", "zh-CN"), false);
  assert.equal(matchesLocale("kimi wa", "en-US"), false);
  assert.equal(matchesLocale("hola mundo", "en-US"), false);
});

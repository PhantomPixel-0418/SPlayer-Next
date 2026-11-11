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

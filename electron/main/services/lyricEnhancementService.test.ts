import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLyricEnhancementService } from "./lyricEnhancementService";
import type { LyricEnhancementRequest } from "@shared/types/lyricEnhancement";

/** 创建包含日语原文的翻译请求 */
const input = (): LyricEnhancementRequest => ({
  versionKey: "v1",
  locale: "en-US",
  translate: true,
  pronunciation: false,
  pronunciationGranularity: "word",
  ruby: false,
  lines: [
    {
      words: [{ word: "こんにちは", startTime: 0, endTime: 1 }],
      translatedLyric: "",
      romanLyric: "",
      language: "ja",
      startTime: 0,
      endTime: 1,
      isBG: false,
      isDuet: false,
    },
  ],
});
/**
 * 创建兼容接口的模拟响应
 * @param lines - 模型返回的行补丁
 * @returns 模拟 HTTP 响应
 */
const openai = (lines: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ lines }) } }] }));

test("OpenAI 请求、缓存隔离及失败不会覆盖原文", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  let model = "one";
  const service = createLyricEnhancementService({
    cacheDir: dir,
    getActiveAiModel: async () => ({
      protocol: "openai-compatible",
      baseUrl: "https://example.test/v1",
      model,
      apiKey: "secret",
    }),
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, "https://example.test/v1/chat/completions");
      assert.equal((options?.headers as Record<string, string>).authorization, "Bearer secret");
      return calls === 3
        ? new Response("private provider error", { status: 500 })
        : openai([{ id: 0, translation: "hello" }]);
    },
  });
  const first = await service.enhanceLyrics(input());
  assert.equal(first.lines[0].translatedLyric, "hello");
  assert.equal(first.lines[0].words[0].word, "こんにちは");
  await service.enhanceLyrics(input());
  assert.equal(calls, 1);
  model = "two";
  await service.enhanceLyrics(input());
  assert.equal(calls, 2);
  const bad = input();
  bad.versionKey = "other";
  const result = await service.enhanceLyrics(bad);
  assert.equal(result.lines[0].translatedLyric, "");
  assert.deepEqual(result.warnings, ["AI 歌词翻译失败"]);
  assert.ok(!JSON.stringify(result).includes("private provider error"));
});

test("Anthropic 发音请求保留英文并按原片段输出", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const service = createLyricEnhancementService({
    cacheDir: dir,
    getActiveAiModel: async () => ({
      protocol: "anthropic",
      baseUrl: "https://example.test/v1",
      model: "test",
      apiKey: "secret",
    }),
    fetch: async (url, options) => {
      assert.equal(url, "https://example.test/v1/messages");
      const headers = options?.headers as Record<string, string>;
      assert.equal(headers["x-api-key"], "secret");
      assert.equal(headers["anthropic-version"], "2023-06-01");
      const prompt = JSON.parse(options!.body as string).messages[0].content as string;
      assert.ok(prompt.includes("lexical words"));
      assert.ok(!prompt.includes("Hello there"));
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: JSON.stringify({ lines: [{ id: 0, romanWords: ["konnichiwa"] }] }),
            },
          ],
        }),
      );
    },
  });
  const request = input();
  request.translate = false;
  request.pronunciation = true;
  request.lines.push({
    ...request.lines[0],
    language: "und-Latn",
    words: [{ word: "Hello there", startTime: 0, endTime: 1, romanWord: "existing" }],
  });
  const result = await service.enhanceLyrics(request);
  assert.equal(result.lines[0].words[0].romanWord, "konnichiwa");
  assert.equal(result.lines[1].words[0].romanWord, "existing");
});

test("补充日语注音写入假名", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const service = createLyricEnhancementService({
    cacheDir: dir,
    getActiveAiModel: async () => ({
      protocol: "openai-compatible",
      baseUrl: "https://example.test/v1",
      model: "test",
      apiKey: "secret",
    }),
    fetch: async () => openai([{ id: 0, ruby: { "0": "きみ" } }]),
  });
  const request = input();
  request.translate = false;
  request.ruby = true;
  request.lines[0].words = [
    { word: "君", startTime: 0, endTime: 1 },
    { word: "の", startTime: 1, endTime: 2 },
  ];
  const result = await service.enhanceLyrics(request);
  assert.deepEqual(result.lines[0].words[0].ruby, [{ word: "きみ", startTime: 0, endTime: 1 }]);
  assert.equal(result.lines[0].words[1].ruby, undefined);
  assert.equal(result.lines[0].generatedRuby?.method, "llm");
  assert.deepEqual(result.warnings, []);
});

test("已有完整音译的日文行不再发音增强", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  const service = createLyricEnhancementService({
    cacheDir: dir,
    getActiveAiModel: async () => ({
      protocol: "openai-compatible",
      baseUrl: "https://example.test/v1",
      model: "test",
      apiKey: "secret",
    }),
    fetch: async () => {
      calls++;
      return openai([{ id: 0, romanLyric: "kimi wa" }]);
    },
  });
  const request = input();
  request.translate = false;
  request.pronunciation = true;
  request.lines[0].words = [
    { word: "君", startTime: 0, endTime: 1 },
    { word: "は", startTime: 1, endTime: 2 },
  ];
  request.lines[0].romanLyric = "kimi wa";
  const result = await service.enhanceLyrics(request);
  assert.equal(calls, 0);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.lines[0].romanLyric, "kimi wa");
});

test("逐行发音增强只写整行音译", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const service = createLyricEnhancementService({
    cacheDir: dir,
    getActiveAiModel: async () => ({
      protocol: "openai-compatible",
      baseUrl: "https://example.test/v1",
      model: "test",
      apiKey: "secret",
    }),
    fetch: async () => openai([{ id: 0, romanLyric: "konnichiwa" }]),
  });
  const request = input();
  request.translate = false;
  request.pronunciation = true;
  request.pronunciationGranularity = "line";
  request.lines[0].words = [
    { word: "こんにちは", startTime: 0, endTime: 1 },
    { word: "", startTime: 1, endTime: 2 },
  ];
  const result = await service.enhanceLyrics(request);
  assert.equal(result.lines[0].romanLyric, "konnichiwa");
  assert.equal(result.lines[0].words[0].romanWord, undefined);
  assert.equal(result.lines[0].generatedPronunciation?.method, "llm");
  assert.deepEqual(result.warnings, []);
});

test("发音增强跳过逻辑的边界", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  const service = createLyricEnhancementService({
    cacheDir: dir,
    getActiveAiModel: async () => ({
      protocol: "openai-compatible",
      baseUrl: "https://example.test/v1",
      model: "test",
      apiKey: "secret",
    }),
    fetch: async () => {
      calls++;
      return openai([{ id: 0, romanLyric: "kimi wa", romanWords: ["kimi", "wa"] }]);
    },
  });

  const run = async (mutate: (request: LyricEnhancementRequest) => void) => {
    calls = 0;
    const request = input();
    request.translate = false;
    request.ruby = false;
    request.pronunciation = true;
    mutate(request);
    const result = await service.enhanceLyrics(request);
    return { calls, warnings: result.warnings };
  };

  // 逐字粒度：所有实义词已带 romanWord 则跳过
  assert.deepEqual(
    await run((request) => {
      request.pronunciationGranularity = "word";
      request.lines[0].words = [
        { word: "君", romanWord: "きみ", startTime: 0, endTime: 1 },
        { word: "は", romanWord: "わ", startTime: 1, endTime: 2 },
      ];
    }),
    { calls: 0, warnings: [] },
  );

  // 逐字粒度：空格填充的 romanWord 不算已有，仍请求
  assert.deepEqual(
    await run((request) => {
      request.pronunciationGranularity = "word";
      request.lines[0].words = [
        { word: "君", romanWord: "   ", startTime: 0, endTime: 1 },
        { word: "は", romanWord: "", startTime: 1, endTime: 2 },
      ];
    }),
    { calls: 1, warnings: [] },
  );

  // 逐行粒度：已有 romanLyric 则跳过，与词级 romanWord 无关
  assert.deepEqual(
    await run((request) => {
      request.pronunciationGranularity = "line";
      request.lines[0].romanLyric = "kimi wa";
    }),
    { calls: 0, warnings: [] },
  );

  // 仅含标点的行不匹配 CJK 字符集，天然不请求
  assert.deepEqual(
    await run((request) => {
      request.lines[0].words = [{ word: "!!!", startTime: 0, endTime: 1 }];
    }),
    { calls: 0, warnings: [] },
  );
});

test("并发请求合并，清理后旧请求不写回缓存", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = createLyricEnhancementService({
    cacheDir: dir,
    getActiveAiModel: async () => ({
      protocol: "openai-compatible",
      baseUrl: "https://example.test/v1",
      model: "test",
      apiKey: "secret",
    }),
    fetch: async () => {
      calls++;
      if (calls === 1) await gate;
      return openai([{ id: 0, translation: "hello" }]);
    },
  });
  const one = service.enhanceLyrics(input());
  const two = service.enhanceLyrics(input());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  await service.clearLyricEnhancementCache();
  release();
  await Promise.all([one, two]);
  assert.equal(fs.existsSync(dir), false);
  await service.enhanceLyrics(input());
  assert.equal(calls, 2);
  assert.equal(fs.readdirSync(dir).filter((name) => name.endsWith(".json")).length, 1);
});

test("非法输入不访问模型", async () => {
  let calls = 0;
  const service = createLyricEnhancementService({
    cacheDir: "unused",
    getActiveAiModel: async () => {
      calls++;
      return null;
    },
    fetch,
  });
  const request = input();
  request.lines[0].words[0].word = "x".repeat(2001);
  assert.ok((await service.enhanceLyrics(request)).warnings.length);
  assert.equal(calls, 0);
});

test("翻译响应错误时仍保留发音增强", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const service = createLyricEnhancementService({
    cacheDir: dir,
    getActiveAiModel: async () => ({
      protocol: "openai-compatible",
      baseUrl: "https://example.test/v1",
      model: "test",
      apiKey: "secret",
    }),
    fetch: async (_url, options) => {
      const prompt = JSON.parse(options!.body as string).messages[0].content as string;
      return prompt.includes("song translation and localization expert")
        ? openai([{ id: 99, translation: "invalid" }])
        : openai([{ id: 0, romanWords: ["konnichiwa"] }]);
    },
  });
  const request = input();
  request.pronunciation = true;
  const result = await service.enhanceLyrics(request);
  assert.equal(result.lines[0].translatedLyric, "");
  assert.equal(result.lines[0].romanLyric, "konnichiwa");
  assert.deepEqual(result.warnings, ["AI 歌词翻译失败"]);
});

test("无效模型响应不会缓存", async (t) => {
  const cases: Array<[string, () => Response, boolean]> = [
    ["错误行号", () => openai([{ id: 9, translation: "hello" }]), false],
    ["缺少行号", () => openai([{ translation: "hello" }]), false],
    ["错误 JSON", () => new Response("{"), false],
    ["超大响应", () => new Response("x".repeat(1024 * 1024 + 1)), false],
    ["部分发音为空", () => openai([{ id: 0, romanWords: ["konnichi", ""] }]), true],
  ];
  for (const [label, response, pronunciation] of cases) {
    await t.test(label, async (subtest) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-test-"));
      subtest.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      let calls = 0;
      const service = createLyricEnhancementService({
        cacheDir: dir,
        getActiveAiModel: async () => ({
          protocol: "openai-compatible",
          baseUrl: "https://example.test/v1",
          model: "test",
          apiKey: "secret",
        }),
        fetch: async () => {
          calls++;
          return response();
        },
      });
      const request = input();
      if (pronunciation) {
        request.translate = false;
        request.pronunciation = true;
        request.lines[0].words = [
          { word: "こんにち", startTime: 0, endTime: 1 },
          { word: "は", startTime: 1, endTime: 2 },
        ];
      }
      assert.equal((await service.enhanceLyrics(request)).warnings.length, 1);
      assert.equal((await service.enhanceLyrics(request)).warnings.length, 1);
      assert.equal(calls, 2);
      assert.deepEqual(fs.readdirSync(dir), []);
    });
  }
});

test("拒绝向非回环 HTTP 地址发送密钥", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  const service = createLyricEnhancementService({
    cacheDir: dir,
    getActiveAiModel: async () => ({
      protocol: "openai-compatible",
      baseUrl: "http://example.test/v1",
      model: "test",
      apiKey: "secret",
    }),
    fetch: async () => {
      calls++;
      return openai([{ id: 0, translation: "hello" }]);
    },
  });
  const result = await service.enhanceLyrics(input());
  assert.equal(calls, 0);
  assert.equal(result.lines[0].translatedLyric, "");
  assert.deepEqual(result.warnings, ["AI 歌词翻译失败"]);
});

test("本地回环地址允许使用 HTTP", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let requested = "";
  const service = createLyricEnhancementService({
    cacheDir: dir,
    getActiveAiModel: async () => ({
      protocol: "openai-compatible",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "test",
      apiKey: "secret",
    }),
    fetch: async (url) => {
      requested = String(url);
      return openai([{ id: 0, translation: "hello" }]);
    },
  });
  const result = await service.enhanceLyrics(input());
  assert.equal(requested, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(result.lines[0].translatedLyric, "hello");
});

import assert from "node:assert/strict";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { Worker } from "node:worker_threads";
import test from "node:test";
import { createLyricDictionaryWorker } from "./lyricDictionaryWorker";
import { optimizeJapaneseLine } from "./lyricDictionaryCore";

const dictionary = path.resolve("node_modules/kuromoji/dict");

test("真实工作线程合并词典加载并限制并发，停止后可重新加载", async () => {
  const worker = createLyricDictionaryWorker(dictionary);
  try {
    const requests = Array.from({ length: 4 }, () => worker.tokenize(["ずっと前の気持ち"]));
    await assert.rejects(worker.tokenize(["他"]), /请求过多/);
    const results = await Promise.all(requests);
    for (const result of results)
      assert.deepEqual(
        result[0].map(({ surface_form }) => surface_form),
        ["ずっと", "前", "の", "気持ち"],
      );
    const tokens = (await worker.tokenize(["捨て切れなくて"]))[0];
    assert.deepEqual(
      tokens.map(({ pos, pos_detail_1 }) => [pos, pos_detail_1]),
      [
        ["動詞", "自立"],
        ["動詞", "非自立"],
        ["助動詞", "*"],
        ["助詞", "接続助詞"],
      ],
    );
    const line = {
      words: [{ word: "捨て切れなくて", startTime: 0, endTime: 100 }],
      language: "ja" as const,
      translatedLyric: "",
      romanLyric: "",
      startTime: 0,
      endTime: 100,
      isBG: false,
      isDuet: false,
    };
    assert.equal(
      optimizeJapaneseLine(line, { tokenize: () => tokens }).romanLyric,
      "sutekirenakute",
    );
    await worker.stop();
    assert.equal((await worker.tokenize(["足元に"]))[0][0].reading, "アシモト");
  } finally {
    await worker.stop();
  }
});

test("词典加载失败释放线程，可以在目录恢复后重试", async () => {
  const { promises: fs } = await import("node:fs");
  const os = await import("node:os");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lyric-worker-"));
  const target = path.join(root, "dict");
  const worker = createLyricDictionaryWorker(target);
  try {
    await assert.rejects(worker.tokenize(["日本語"]));
    await fs.symlink(dictionary, target, "junction");
    assert.equal((await worker.tokenize(["足元"]))[0][0].reading, "アシモト");
  } finally {
    await worker.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("终止处理中线程会拒绝任务，并允许重新创建", async () => {
  const worker = createLyricDictionaryWorker(dictionary, { idleMs: 30 });
  try {
    const pending = assert.rejects(worker.tokenize(["日本語"]), /关闭/);
    await worker.stop();
    await pending;
    assert.equal((await worker.tokenize(["足元"]))[0][0].reading, "アシモト");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await worker.tokenize(["足元"]))[0][0].reading, "アシモト");
  } finally {
    await worker.stop();
  }
});

test("活动期间不会回收线程，全部完成后空闲回收", async () => {
  let terminations = 0;
  const fake = new EventEmitter() as EventEmitter & {
    postMessage: (message: { id: number }) => void;
    terminate: () => Promise<number>;
  };
  fake.postMessage = ({ id }) => setTimeout(() => fake.emit("message", { id, result: [[]] }), 50);
  fake.terminate = async () => {
    terminations++;
    return 0;
  };
  const worker = createLyricDictionaryWorker(dictionary, {
    idleMs: 15,
    createWorker: () => fake as unknown as Worker,
  });
  try {
    const pending = worker.tokenize(["かな"]);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(terminations, 0);
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(terminations, 1);
  } finally {
    await worker.stop();
  }
});

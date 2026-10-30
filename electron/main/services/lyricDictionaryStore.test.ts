import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLyricDictionaryStore } from "./lyricDictionaryStore";

const hash = createHash("sha256").update("fixture").digest("hex");

test("下载失败后清理临时目录，可重试并合并并发下载", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lyric-dictionary-"));
  let count = 0;
  let fail = true;
  const store = createLyricDictionaryStore({
    root,
    version: "test",
    files: { "a.gz": hash, "b.gz": hash },
    fetchFile: async () => {
      count++;
      if (fail) return new Response("error", { status: 500 });
      return new Response("fixture");
    },
  });
  try {
    await assert.rejects(store.downloadLyricDictionary());
    assert.deepEqual(await fs.readdir(root), []);
    assert.equal((await store.getLyricDictionaryStatus()).installed, false);
    fail = false;
    const [first, second] = await Promise.all([
      store.downloadLyricDictionary(),
      store.downloadLyricDictionary(),
    ]);
    assert.equal(first.installed, true);
    assert.deepEqual(second, first);
    assert.equal(count, 3);
    await fs.rm(path.join(root, "test", "b.gz"));
    assert.equal((await store.getLyricDictionaryStatus()).installed, false);
    await store.downloadLyricDictionary();
    assert.equal((await store.getLyricDictionaryStatus()).installed, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

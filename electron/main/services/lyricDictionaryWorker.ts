import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import type { IpadicFeatures } from "kuromoji";

type Token = Pick<
  IpadicFeatures,
  "surface_form" | "reading" | "pos" | "pos_detail_1" | "conjugated_form"
>;
const nodeRequire = createRequire(import.meta.url);
const workerSource = `
const { parentPort, workerData } = require("node:worker_threads");
const kuromoji = require(workerData.modulePath);
const tokenizer = new Promise((resolve, reject) =>
  kuromoji.builder({ dicPath: workerData.directory }).build((error, result) => error ? reject(error) : resolve(result))
);
parentPort.on("message", async ({ id, texts }) => {
  try {
    const engine = await tokenizer;
    const result = texts.map(text => engine.tokenize(text).map(({ surface_form, reading, pos, pos_detail_1, conjugated_form }) => ({ surface_form, reading, pos, pos_detail_1, conjugated_form })));
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error) });
  }
});
`;

/**
 * 创建可空闲释放的独立词典工作线程
 * @param directory - 已安装词典目录
 * @param options - 工作线程构造与空闲时间，用于隔离测试
 * @returns 分词及终止操作
 */
export function createLyricDictionaryWorker(
  directory: string,
  options: { idleMs?: number; createWorker?: () => Worker } = {},
) {
  const createWorker =
    options.createWorker ??
    (() =>
      new Worker(workerSource, {
        eval: true,
        workerData: { modulePath: nodeRequire.resolve("kuromoji"), directory },
      }));
  let worker: Worker | undefined;
  let stopping: Promise<void> | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0;
  let generation = 0;
  const pending = new Map<
    number,
    { resolve: (result: Token[][]) => void; reject: (error: Error) => void }
  >();

  /**
   * 结束线程并拒绝未完成任务
   * @param reason - 结束原因
   */
  async function stop(reason = "日语词典工作线程已关闭"): Promise<void> {
    generation++;
    if (idle) clearTimeout(idle);
    idle = undefined;
    const previous = worker;
    worker = undefined;
    for (const task of pending.values()) task.reject(new Error(reason));
    pending.clear();
    if (previous) {
      stopping = previous.terminate().then(() => {});
      try {
        await stopping;
      } finally {
        stopping = undefined;
      }
    } else if (stopping) {
      await stopping;
    }
  }

  /** 获取或创建单个工作线程 */
  function getWorker(): Worker {
    if (worker) return worker;
    const current = createWorker();
    worker = current;
    current.on("message", (message: { id: number; result?: Token[][]; error?: string }) => {
      if (worker !== current) return;
      const task = pending.get(message.id);
      if (!task) return;
      if (message.error || !message.result) {
        void stop(message.error || "日语词典工作线程返回无效结果");
        return;
      }
      pending.delete(message.id);
      task.resolve(message.result);
      if (!pending.size) {
        if (idle) clearTimeout(idle);
        idle = setTimeout(() => {
          void stop();
        }, options.idleMs ?? 60_000);
        idle.unref();
      }
    });
    current.on("error", (error) => {
      if (worker === current) void stop(error.message);
    });
    current.on("exit", (code) => {
      if (worker === current) void stop(`日语词典工作线程退出: ${code}`);
    });
    return current;
  }

  /**
   * 将一首歌词的日语文本送入工作线程
   * @param texts - 待分词的日语文本
   * @returns 每行的词典分词结果
   */
  async function tokenize(texts: string[]): Promise<Token[][]> {
    const currentGeneration = generation;
    if (stopping) await stopping;
    if (generation !== currentGeneration) throw new Error("日语词典工作线程已关闭");
    if (pending.size >= 4) throw new Error("日语词典请求过多");
    if (idle) clearTimeout(idle);
    idle = undefined;
    const current = getWorker();
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        current.postMessage({ id, texts });
      } catch (error) {
        void stop(String(error));
      }
    });
  }

  return { tokenize, stop };
}

import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import zhCN from "@/i18n/locales/zh-CN.json";
import type { AiModelState } from "@shared/types/ai";
import type { LyricDictionaryStatus } from "@shared/types/lyricEnhancement";
import LyricEnhancementConfig from "./LyricEnhancementConfig.vue";

const fixtures = vi.hoisted(() => ({
  listModels: vi.fn(),
  dictionaryStatus: vi.fn(),
  downloadDictionary: vi.fn(),
  removeDictionary: vi.fn(),
  clearCache: vi.fn(),
}));

let wrapper: VueWrapper | undefined;
let lyricCategory: (typeof import("@/settings/categories/lyric"))["default"];
const cleanupListeners: (() => void)[] = [];
const models: AiModelState = {
  models: [
    {
      id: "model-1",
      name: "翻译模型",
      protocol: "openai-compatible",
      baseUrl: "https://example.test/v1",
      model: "example-model",
      hasApiKey: true,
    },
  ],
  activeModelId: "model-1",
};
const notInstalled: LyricDictionaryStatus = {
  installed: false,
  downloading: false,
  version: "1",
};

/** 挂载歌词增强设置面板 */
const mountConfig = (): VueWrapper =>
  mount(LyricEnhancementConfig, {
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale: "zh-CN",
          messages: { "zh-CN": zhCN },
        }),
      ],
      stubs: {
        AiModelConfig: { template: "<div data-test='ai-model-config' />" },
        IconLucideBot: true,
        IconLucideBookOpen: true,
        IconLucideTrash2: true,
        SButton: {
          props: ["loading", "disabled"],
          emits: ["click"],
          template:
            "<button :disabled='disabled' :data-loading='String(loading)' @click='$emit(\"click\")'><slot name='icon' /><slot /></button>",
        },
        SDialog: {
          props: ["open", "title"],
          emits: ["update:open"],
          template:
            "<div v-if='open' data-test='dialog'><slot /><button data-test='close' @click='$emit(\"update:open\", false)'>close</button></div>",
        },
        STag: { template: "<span class='tag'><slot /></span>" },
      },
    },
  });

beforeEach(() => {
  fixtures.listModels.mockResolvedValue(models);
  fixtures.dictionaryStatus.mockResolvedValue(notInstalled);
  fixtures.downloadDictionary.mockResolvedValue({ ...notInstalled, installed: true });
  fixtures.removeDictionary.mockResolvedValue(notInstalled);
  fixtures.clearCache.mockResolvedValue(undefined);
  Object.assign(window, {
    api: {
      system: { platform: "win32" },
      aiModel: { list: fixtures.listModels },
      lyricEnhancement: {
        dictionaryStatus: fixtures.dictionaryStatus,
        downloadDictionary: fixtures.downloadDictionary,
        removeDictionary: fixtures.removeDictionary,
        clearCache: fixtures.clearCache,
      },
    },
  });
});

beforeAll(async () => {
  vi.stubGlobal("__COMMIT_HASH__", "test");
  vi.stubGlobal("__COMMIT_DATE__", "test");
  Object.assign(window, { api: { system: { platform: "win32" } } });
  lyricCategory = (await import("@/settings/categories/lyric")).default;
});

afterAll(() => vi.unstubAllGlobals());

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  cleanupListeners.splice(0).forEach((cleanup) => cleanup());
});

describe("歌词增强设置 UI", () => {
  it("读取当前模型和词典状态，并提供带 Beta 标记的开关设置", async () => {
    wrapper = mountConfig();
    await flushPromises();
    expect(wrapper.text()).toContain("翻译模型 · example-model");
    expect(wrapper.text()).toContain(zhCN.settings.lyricEnhancement.notInstalled);
    expect(wrapper.text()).toContain(zhCN.settings.lyricEnhancement.downloadDictionary);

    const section = lyricCategory.sections?.find(
      (item) => item.id === "lyricTranslationPronunciation",
    );
    const translation = section?.items.find((item) => item.key === "llmTranslation");
    const pronunciation = section?.items.find((item) => item.key === "pronunciationOptimization");
    expect(translation).toMatchObject({
      type: "switch",
      defaultValue: false,
      tag: { text: "Beta" },
    });
    expect(pronunciation).toMatchObject({
      type: "select",
      defaultValue: "off",
      tag: { text: "Beta" },
      options: expect.arrayContaining([
        { value: "off", labelKey: "settings.pronunciationOptimization.off" },
        { value: "llm", labelKey: "settings.pronunciationOptimization.llm" },
        { value: "dictionary", labelKey: "settings.pronunciationOptimization.dictionary" },
      ]),
    });
  });

  it("词典下载失败显示错误，成功后更新状态并通知当前歌词", async () => {
    wrapper = mountConfig();
    await flushPromises();
    const changed = vi.fn();
    window.addEventListener("lyric-enhancement:changed", changed);
    cleanupListeners.push(() => window.removeEventListener("lyric-enhancement:changed", changed));

    fixtures.downloadDictionary.mockRejectedValueOnce(new Error("download failed"));
    await wrapper.findAll("button")[1].trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("download failed");
    expect(changed).not.toHaveBeenCalled();
    expect(wrapper.findAll("button")[1].attributes("disabled")).toBeUndefined();
    expect(wrapper.findAll("button")[1].attributes("data-loading")).toBe("false");

    fixtures.downloadDictionary.mockResolvedValueOnce({ ...notInstalled, installed: true });
    await wrapper.findAll("button")[1].trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain(zhCN.settings.lyricEnhancement.installed);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("关闭模型配置弹窗后重新读取模型和词典状态并通知当前歌词", async () => {
    wrapper = mountConfig();
    await flushPromises();
    const changed = vi.fn();
    window.addEventListener("lyric-enhancement:changed", changed);
    cleanupListeners.push(() => window.removeEventListener("lyric-enhancement:changed", changed));

    await wrapper.findAll("button")[0].trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-test='ai-model-config']").exists()).toBe(true);

    await wrapper.get("[data-test='close']").trigger("click");
    await flushPromises();
    expect(fixtures.listModels).toHaveBeenCalledTimes(2);
    expect(fixtures.dictionaryStatus).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

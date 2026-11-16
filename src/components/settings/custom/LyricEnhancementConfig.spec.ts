import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import zhCN from "@/i18n/locales/zh-CN.json";
import type { AiModelState } from "@shared/types/ai";
import { toast } from "@/composables/useToast";
import LyricEnhancementConfig from "./LyricEnhancementConfig.vue";

vi.mock("@/composables/useToast", () => ({ toast: { success: vi.fn() } }));

const fixtures = vi.hoisted(() => ({
  listModels: vi.fn(),
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
  fixtures.clearCache.mockResolvedValue(undefined);
  Object.assign(window, {
    api: {
      system: { platform: "win32" },
      aiModel: { list: fixtures.listModels },
      lyricEnhancement: { clearCache: fixtures.clearCache },
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
  it("读取当前模型，并提供带 Beta 标记的开关设置", async () => {
    wrapper = mountConfig();
    await flushPromises();
    expect(wrapper.text()).toContain("翻译模型 · example-model");

    const section = lyricCategory.sections?.find(
      (item) => item.id === "lyricTranslationPronunciation",
    );
    const translation = section?.items.find((item) => item.key === "llmTranslation");
    const pronunciation = section?.items.find((item) => item.key === "pronunciationOptimization");
    const ruby = section?.items.find((item) => item.key === "llmRuby");
    expect(translation).toMatchObject({
      type: "switch",
      defaultValue: false,
      tag: { text: "Beta" },
    });
    expect(pronunciation).toMatchObject({
      type: "switch",
      defaultValue: false,
      tag: { text: "Beta" },
    });
    expect(ruby).toMatchObject({
      type: "switch",
      defaultValue: false,
      tag: { text: "Beta" },
    });
  });

  it("清除生成缓存失败显示错误，成功后通知当前歌词", async () => {
    wrapper = mountConfig();
    await flushPromises();
    const changed = vi.fn();
    window.addEventListener("lyric-enhancement:changed", changed);
    cleanupListeners.push(() => window.removeEventListener("lyric-enhancement:changed", changed));

    fixtures.clearCache.mockRejectedValueOnce(new Error("clear failed"));
    await wrapper.findAll("button")[1].trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("clear failed");
    expect(changed).not.toHaveBeenCalled();
    expect(wrapper.findAll("button")[1].attributes("data-loading")).toBe("false");

    await wrapper.findAll("button")[1].trigger("click");
    await flushPromises();
    expect(fixtures.clearCache).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(zhCN.settings.lyricEnhancement.cacheCleared);
  });

  it("关闭模型配置弹窗后重新读取模型并通知当前歌词", async () => {
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
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

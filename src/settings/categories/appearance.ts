import type { SettingCategory, SettingItem, SettingOption } from "@/types/settings-schema";
import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";
import type { PlayerBgRenderer } from "@/types/settings";
import FontConfig from "@/components/settings/custom/FontConfig.vue";
import BackgroundImagePicker from "@/components/settings/custom/BackgroundImagePicker.vue";
import SidebarCustomizeConfig from "@/components/settings/custom/SidebarCustomizeConfig.vue";
import IconLucidePalette from "~icons/lucide/palette";

/** 当前渲染器为流沙渲染器 */
const isTitaniumActive = (): boolean => useSettingsStore().player.playerBgRenderer === "titanium";

/** 支持低频脉动的渲染器 */
const BEAT_RENDERERS = new Set<PlayerBgRenderer>(["mesh", "titanium"]);

const RENDERER_OPTIONS: SettingOption[] = [
  { value: "mesh", labelKey: "settings.playerBgRenderer.mesh" },
  { value: "isolation", labelKey: "settings.playerBgRenderer.isolation" },
  { value: "pixi", labelKey: "settings.playerBgRenderer.pixi" },
  { value: "titanium", labelKey: "settings.playerBgRenderer.titanium" },
];

/** 流沙渲染器参数项，顺序与官方一致：取色算法决定底层输入故前置，抖动是后期处理故置尾 */
const TITANIUM_ITEMS: SettingItem[] = [
  {
    key: "titaniumPaletteAlgorithm",
    type: "select",
    binding: { store: "settings", path: "player.playerBgTitanium.paletteAlgorithm" },
    options: [
      { value: "auto", labelKey: "settings.titaniumPaletteAlgorithm.auto" },
      { value: "kmeans", labelKey: "settings.titaniumPaletteAlgorithm.kmeans" },
      { value: "octtree", labelKey: "settings.titaniumPaletteAlgorithm.octtree" },
    ],
    defaultValue: "auto",
    visible: isTitaniumActive,
  },
  {
    key: "titaniumGrain",
    type: "slider",
    binding: { store: "settings", path: "player.playerBgTitanium.grain" },
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.7,
    marks: { 0: "0", 0.7: "0.7", 1: "1" },
    visible: isTitaniumActive,
  },
  {
    key: "titaniumSparkle",
    type: "slider",
    binding: { store: "settings", path: "player.playerBgTitanium.sparkle" },
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.75,
    marks: { 0: "0", 0.75: "0.75", 1: "1" },
    visible: isTitaniumActive,
  },
  {
    key: "titaniumSheen",
    type: "slider",
    binding: { store: "settings", path: "player.playerBgTitanium.sheen" },
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.5,
    marks: { 0: "0", 0.5: "0.5", 1: "1" },
    visible: isTitaniumActive,
  },
  {
    key: "titaniumMetalness",
    type: "slider",
    binding: { store: "settings", path: "player.playerBgTitanium.metalness" },
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.35,
    marks: { 0: "0", 0.35: "0.35", 1: "1" },
    visible: isTitaniumActive,
  },
  {
    key: "titaniumCrestShift",
    type: "number",
    binding: { store: "settings", path: "player.playerBgTitanium.crestShiftMs" },
    min: 300,
    max: 6000,
    step: 100,
    defaultValue: 2000,
    unit: "ms",
    visible: isTitaniumActive,
  },
  {
    key: "titaniumDithering",
    type: "switch",
    binding: { store: "settings", path: "player.playerBgTitanium.dithering" },
    defaultValue: true,
    visible: isTitaniumActive,
  },
];

const appearanceCategory: SettingCategory = {
  id: "appearance",
  icon: IconLucidePalette,
  sections: [
    {
      id: "theme",
      items: [
        {
          key: "themeMode",
          type: "select",
          binding: { store: "theme", path: "mode" },
          options: [
            { value: "light", labelKey: "settings.themeMode.light" },
            { value: "dark", labelKey: "settings.themeMode.dark" },
            { value: "system", labelKey: "settings.themeMode.system" },
          ],
          defaultValue: "system",
          // 图片背景下强制暗色，禁用此开关
          disabled: () => useThemeStore().appearanceStyle === "image",
        },
        {
          key: "themeSource",
          type: "select",
          binding: { store: "theme", path: "source" },
          options: [
            { value: "default", labelKey: "settings.themeSource.default" },
            { value: "custom", labelKey: "settings.themeSource.custom" },
            { value: "cover", labelKey: "settings.themeSource.cover" },
            { value: "solid", labelKey: "settings.themeSource.solid" },
          ],
          defaultValue: "default",
          childrenCondition: () => useThemeStore().source === "custom",
          hideChildren: true,
          children: [
            {
              key: "customColor",
              type: "color",
              binding: { store: "theme", path: "customColor" },
              defaultValue: "#fe7971",
              showAlpha: false,
              colorFormat: "hex",
            },
          ],
        },
        {
          key: "globalTint",
          type: "switch",
          binding: { store: "theme", path: "globalTint" },
          defaultValue: false,
          // 图片背景下强制开启全局着色，禁用切换
          disabled: () => useThemeStore().appearanceStyle === "image",
        },
      ],
    },
    {
      id: "appearanceStyle",
      items: [
        {
          key: "appearanceStyle",
          type: "select",
          binding: { store: "theme", path: "appearanceStyle" },
          options: [
            { value: "solid", labelKey: "settings.appearanceStyle.solid" },
            { value: "image", labelKey: "settings.appearanceStyle.image" },
          ],
          defaultValue: "solid",
          childrenCondition: () => useThemeStore().appearanceStyle === "image",
          hideChildren: true,
          children: [
            {
              key: "backgroundImage",
              type: "custom",
              component: BackgroundImagePicker,
            },
            {
              key: "backgroundBlur",
              type: "slider",
              binding: { store: "theme", path: "imageBackground.blur" },
              min: 0,
              max: 80,
              step: 1,
              defaultValue: 0,
              marks: { 0: "0", 20: "20", 40: "40", 80: "80" },
            },
            {
              key: "backgroundDim",
              type: "slider",
              binding: { store: "theme", path: "imageBackground.dim" },
              min: 0.3,
              max: 0.9,
              step: 0.05,
              defaultValue: 0.4,
              marks: { 0.3: "0.3", 0.4: "0.4", 0.9: "0.9" },
            },
            {
              key: "backgroundScale",
              type: "slider",
              binding: { store: "theme", path: "imageBackground.scale" },
              min: 1,
              max: 2,
              step: 0.05,
              defaultValue: 1.2,
              marks: { 1: "1", 1.2: "1.2", 2: "2" },
            },
          ],
        },
      ],
    },
    {
      id: "font",
      items: [
        {
          key: "fontConfig",
          type: "custom",
          component: FontConfig,
        },
      ],
    },
    {
      id: "layout",
      items: [
        {
          key: "layoutMode",
          type: "select",
          binding: { store: "settings", path: "appearance.layoutMode" },
          options: [
            { value: "default", labelKey: "settings.layoutMode.default" },
            { value: "sidebar-full", labelKey: "settings.layoutMode.sidebarFull" },
            { value: "floating", labelKey: "settings.layoutMode.floating" },
          ],
          defaultValue: "default",
        },
        {
          key: "songListStyle",
          type: "select",
          binding: { store: "settings", path: "appearance.songListStyle" },
          options: [
            { value: "comfortable", labelKey: "settings.songListStyle.comfortable" },
            { value: "compact", labelKey: "settings.songListStyle.compact" },
          ],
          defaultValue: "comfortable",
        },
        {
          key: "sidebarCollapsed",
          type: "switch",
          binding: { store: "settings", path: "appearance.sidebarCollapsed" },
          defaultValue: false,
        },
        {
          key: "sidebarPlaylistCover",
          type: "switch",
          binding: { store: "settings", path: "appearance.sidebarPlaylistCover" },
          defaultValue: false,
        },
        {
          key: "sidebarCustomize",
          type: "custom",
          component: SidebarCustomizeConfig,
        },
        {
          key: "showQualitySwitch",
          type: "switch",
          binding: { store: "settings", path: "appearance.showQualitySwitch" },
          defaultValue: false,
        },
      ],
    },
    {
      id: "softwareAnimations",
      items: [
        {
          key: "reduceMotion",
          type: "switch",
          binding: { store: "settings", path: "appearance.reduceMotion" },
          defaultValue: false,
        },
        {
          key: "routeTransition",
          type: "select",
          binding: { store: "settings", path: "appearance.routeTransition" },
          options: [
            { value: "none", labelKey: "settings.routeTransition.none" },
            { value: "fade", labelKey: "settings.routeTransition.fade" },
            { value: "slide", labelKey: "settings.routeTransition.slide" },
            { value: "zoom", labelKey: "settings.routeTransition.zoom" },
          ],
          defaultValue: "fade",
        },
        {
          key: "seamlessTransition",
          type: "switch",
          binding: { store: "settings", path: "appearance.seamlessTransition" },
          defaultValue: false,
        },
      ],
    },
    {
      id: "playerBar",
      items: [
        {
          key: "showLyricInBar",
          type: "switch",
          binding: { store: "settings", path: "player.showLyricInBar" },
          defaultValue: true,
        },
        {
          key: "showProgressTooltip",
          type: "switch",
          binding: { store: "settings", path: "player.showProgressTooltip" },
          defaultValue: true,
          children: [
            {
              key: "showProgressLyric",
              type: "switch",
              binding: { store: "settings", path: "player.showProgressLyric" },
              defaultValue: false,
            },
          ],
        },
        {
          key: "snapToLyric",
          type: "switch",
          binding: { store: "settings", path: "player.snapToLyric" },
          defaultValue: false,
        },
        {
          key: "timeFormat",
          type: "select",
          binding: { store: "settings", path: "player.timeFormat" },
          options: [
            { value: "current-total", labelKey: "settings.timeFormat.currentTotal" },
            { value: "remaining-total", labelKey: "settings.timeFormat.remainingTotal" },
            { value: "current-remaining", labelKey: "settings.timeFormat.currentRemaining" },
          ],
          defaultValue: "current-total",
          descriptionKey: "settings.timeFormat.description",
        },
      ],
    },
    {
      id: "nowPlaying",
      items: [
        {
          key: "playerBgType",
          type: "select",
          binding: { store: "settings", path: "player.playerBgType" },
          options: [
            { value: "blur", labelKey: "settings.playerBgType.blur" },
            { value: "solid", labelKey: "settings.playerBgType.solid" },
            { value: "animation", labelKey: "settings.playerBgType.animation" },
          ],
          defaultValue: "blur",
          confirm: {
            when: (next) => next === "animation",
            titleKey: "settings.confirm.highResourceTitle",
            contentKey: "settings.confirm.highResourceContent",
            type: "warning",
          },
          childrenCondition: () => useSettingsStore().player.playerBgType === "animation",
          hideChildren: true,
          children: [
            {
              key: "playerBgRenderer",
              type: "select",
              binding: { store: "settings", path: "player.playerBgRenderer" },
              options: RENDERER_OPTIONS,
              defaultValue: "mesh",
            },
            {
              key: "playerBgFlowSpeed",
              type: "slider",
              binding: { store: "settings", path: "player.playerBgFlowSpeed" },
              min: 0.1,
              max: 10,
              step: 0.1,
              defaultValue: 4,
              marks: { 0.1: "0.1", 4: "4", 10: "10" },
            },
            {
              key: "playerBgRenderScale",
              type: "slider",
              binding: { store: "settings", path: "player.playerBgRenderScale" },
              min: 0.5,
              max: 2,
              step: 0.1,
              defaultValue: 0.5,
              marks: { 0.5: "0.5", 1: "1", 2: "2" },
            },
            {
              key: "playerBgFps",
              type: "slider",
              binding: { store: "settings", path: "player.playerBgFps" },
              min: 24,
              max: 120,
              step: 2,
              defaultValue: 30,
              marks: { 24: "24", 60: "60", 120: "120" },
            },
            {
              key: "playerBgFreezeOnPause",
              type: "switch",
              binding: { store: "settings", path: "player.playerBgFreezeOnPause" },
              defaultValue: false,
            },
            {
              key: "playerBgBeat",
              type: "switch",
              binding: { store: "settings", path: "player.playerBgBeat" },
              // 刻意不叠加 bgRendererSupport：流沙渲染器缺失时会降级到网格渐变，脉动依然有效
              visible: () => BEAT_RENDERERS.has(useSettingsStore().player.playerBgRenderer),
              defaultValue: false,
            },
            ...TITANIUM_ITEMS,
          ],
        },
        {
          key: "coverLayout",
          type: "select",
          binding: { store: "settings", path: "player.coverLayout" },
          options: [
            { value: "default", labelKey: "settings.coverLayout.default" },
            { value: "fullscreen", labelKey: "settings.coverLayout.fullscreen" },
          ],
          defaultValue: "default",
        },
        {
          key: "coverLyricRatio",
          type: "slider",
          binding: { store: "settings", path: "player.coverLyricRatio" },
          min: 0.3,
          max: 0.6,
          step: 0.05,
          defaultValue: 0.45,
          marks: { 0.3: "30%", 0.45: "45%", 0.6: "60%" },
        },
        {
          key: "autoCenterCover",
          type: "switch",
          binding: { store: "settings", path: "player.autoCenterCover" },
          defaultValue: true,
        },
        {
          key: "showPlaybackSource",
          type: "switch",
          binding: { store: "settings", path: "player.showPlaybackSource" },
          defaultValue: false,
        },
        {
          key: "followCoverColor",
          type: "switch",
          binding: { store: "settings", path: "player.followCoverColor" },
          defaultValue: true,
        },
        {
          key: "autoImmersive",
          type: "switch",
          binding: { store: "settings", path: "player.autoImmersive" },
          defaultValue: false,
        },
        {
          key: "keepScreenAwake",
          type: "switch",
          binding: { store: "settings", path: "system.player.keepScreenAwake" },
          defaultValue: false,
        },
      ],
    },
  ],
};

export default appearanceCategory;

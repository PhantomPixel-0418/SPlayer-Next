import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { coverTransitionActive } from "@/services/coverTransition";

export const fullPlayerReady = shallowRef(false);
export const playerTransition = shallowRef<ViewTransition | null>(null);
export const playerTransitionActive = computed(() => playerTransition.value !== null);
const playerModeTransition = shallowRef<ViewTransition | null>(null);
/** 播放器三态切换的共享元素过渡是否进行中 */
export const playerModeTransitionActive = computed(() => playerModeTransition.value !== null);
let covers: HTMLElement[] = [];

/** 取消播放器三态切换的共享元素快照 */
const cancelPlayerModeTransition = (): void => {
  const active = playerModeTransition.value;
  if (!active) return;
  playerModeTransition.value = null;
  active.skipTransition();
  document.documentElement.removeAttribute("data-player-mode-transition");
};

/** 释放播放器快照和临时标记，取消尚未完成的封面匹配 */
export const cancelPlayerTransition = (): void => {
  cancelPlayerModeTransition();
  const active = playerTransition.value;
  if (!active) return;
  playerTransition.value = null;
  active.skipTransition();
  for (const cover of covers) cover.removeAttribute("data-player-shared");
  covers = [];
  const root = document.documentElement;
  root.removeAttribute("data-player-transition");
  root.style.removeProperty("--player-cover-from-radius");
  root.style.removeProperty("--player-cover-to-radius");
};

/**
 * 在播放器三态之间使用共享元素过渡，条件不满足时直接更新状态
 * @param update - 更新播放器显示状态
 */
export const transitionPlayerMode = (update: () => void): void => {
  const settings = useSettingsStore();
  if (playerModeTransition.value) {
    cancelPlayerModeTransition();
    update();
    return;
  }
  if (
    !settings.appearance.seamlessTransition ||
    settings.reducedMotion ||
    !document.startViewTransition ||
    document.hidden ||
    playerTransitionActive.value ||
    coverTransitionActive.value
  ) {
    update();
    return;
  }

  const root = document.documentElement;
  root.setAttribute("data-player-mode-transition", "");
  const active = document.startViewTransition(async () => {
    if (playerModeTransition.value !== active) return;
    update();
    await nextTick();
  });
  playerModeTransition.value = active;
  void active.ready.catch(() => {});
  void active.finished
    .finally(() => {
      if (playerModeTransition.value !== active) return;
      playerModeTransition.value = null;
      root.removeAttribute("data-player-mode-transition");
    })
    .catch(() => {});
};

/**
 * 在底栏与展开播放器之间匹配封面，其余情况沿用原有展开动画
 * @param expanded - 是否展开播放器
 */
export const setPlayerExpanded = (expanded: boolean): void => {
  // 三态切换过渡在飞时放弃共享元素匹配，避免抢占快照导致封面跳位
  const modeTransitionActive = playerModeTransitionActive.value;
  cancelPlayerTransition();
  const status = useStatusStore();
  if (status.isPlayerExpanded === expanded) return;
  const settings = useSettingsStore();
  if (
    modeTransitionActive ||
    !settings.appearance.seamlessTransition ||
    settings.reducedMotion ||
    !document.startViewTransition ||
    document.hidden ||
    coverTransitionActive.value
  ) {
    status.isPlayerExpanded = expanded;
    return;
  }

  const source = document.querySelector<HTMLElement>(
    `[data-player-cover="${expanded ? "bar" : "full"}"]`,
  );
  const image = source?.querySelector<HTMLImageElement>(expanded ? "img[data-cover-image]" : "img");
  if (!source || !image?.complete || !image.naturalWidth || !source.checkVisibility()) {
    status.isPlayerExpanded = expanded;
    return;
  }

  const root = document.documentElement;
  source.setAttribute("data-player-shared", "");
  covers.push(source);
  root.setAttribute("data-player-transition", expanded ? "expand" : "collapse");
  root.style.setProperty("--player-cover-from-radius", getComputedStyle(source).borderRadius);
  const active = document.startViewTransition(async () => {
    if (playerTransition.value !== active) return;
    source.removeAttribute("data-player-shared");
    status.isPlayerExpanded = expanded;
    // 首次展开等待懒加载挂载，取消时也结束等待
    if (expanded) {
      await until(() => fullPlayerReady.value || playerTransition.value !== active).toBe(true);
    }
    await nextTick();
    if (playerTransition.value !== active) return;
    const target = document.querySelector<HTMLElement>(
      `[data-player-cover="${expanded ? "full" : "bar"}"]`,
    );
    const targetImage = target?.querySelector<HTMLImageElement>("img");
    // 仅解码已加载图片或相同地址的缩略图，避免等待高清图片的网络请求
    if (targetImage && (targetImage.complete || targetImage.src === image.src)) {
      await targetImage.decode().catch(() => {});
    }
    if (playerTransition.value !== active || !target) return;
    covers.push(target);
    target.setAttribute("data-player-shared", "");
    root.style.setProperty("--player-cover-to-radius", getComputedStyle(target).borderRadius);
  });
  playerTransition.value = active;
  void active.ready.catch(() => {});
  void active.finished
    .finally(() => {
      if (playerTransition.value === active) cancelPlayerTransition();
    })
    .catch(() => {});
};

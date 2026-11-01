/**
 * 清除曲目信息栏过渡高度记录
 * @param element - 曲目信息栏元素
 */
export const resetTrackInfoHeight = (element: Element): void => {
  if (!(element instanceof HTMLElement)) return;
  element.style.removeProperty("--lyric-track-info-height");
};

/**
 * 保存曲目信息栏离场前的实际高度，供收起过渡使用
 * @param element - 曲目信息栏元素
 */
export const captureTrackInfoHeight = (element: Element): void => {
  if (!(element instanceof HTMLElement)) return;
  const { height } = element.getBoundingClientRect();
  element.style.setProperty("--lyric-track-info-height", `${height}px`);
};

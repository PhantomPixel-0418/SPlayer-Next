/**
 * 判断歌词切换按钮是否应禁用
 * @param hasLyric - 当前歌曲是否有歌词
 * @param showCover - 当前是否显示封面
 * @returns 按钮是否禁用
 */
export const isLyricToggleDisabled = (hasLyric: boolean, showCover: boolean): boolean =>
  !hasLyric && showCover;

/**
 * 判断是否应自动居中封面
 * @param fullscreenCover - 是否使用全屏封面布局
 * @param queueOpen - 播放队列是否打开
 * @param showLyric - 是否显示歌词
 * @param autoCenterCover - 是否启用无歌词时居中封面
 * @param hasLyric - 当前歌曲是否有歌词
 * @param showCover - 当前是否显示封面
 * @returns 是否居中封面
 */
export const shouldCenterCover = (
  fullscreenCover: boolean,
  queueOpen: boolean,
  showLyric: boolean,
  autoCenterCover: boolean,
  hasLyric: boolean,
  showCover: boolean,
): boolean => {
  if (fullscreenCover || queueOpen) return false;
  return !showLyric || (showCover && autoCenterCover && !hasLyric);
};

/**
 * 判断隐藏歌词时是否可以视为歌词区已就绪
 * @param showLyric - 是否显示歌词
 * @param hasLyric - 当前歌曲是否有歌词
 * @returns 是否可以继续初始化播放器可视化
 */
export const shouldTreatLyricsAsReady = (showLyric: boolean, hasLyric: boolean): boolean =>
  !hasLyric || !showLyric;

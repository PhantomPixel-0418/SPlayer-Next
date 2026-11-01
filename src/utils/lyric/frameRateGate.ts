export interface FrameRateGate {
  nextUpdateAt?: number;
}

/**
 * 按目标帧率决定是否更新，并补偿浏览器帧间隔导致的限帧误差
 * @param now - 当前高精度时间戳（毫秒）
 * @param gate - 下次更新时间状态
 * @param frameRate - 目标帧率
 * @param force - 是否立即更新并重置间隔
 * @returns 是否允许更新
 */
export const shouldUpdateFrame = (
  now: number,
  gate: FrameRateGate,
  frameRate: number,
  force = false,
): boolean => {
  const interval = 1000 / frameRate;
  if (gate.nextUpdateAt === undefined || force) {
    gate.nextUpdateAt = now + interval;
    return true;
  }
  if (now < gate.nextUpdateAt) return false;
  const skippedIntervals = Math.floor((now - gate.nextUpdateAt) / interval) + 1;
  gate.nextUpdateAt += skippedIntervals * interval;
  return true;
};

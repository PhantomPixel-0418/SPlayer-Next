/**
 * 创建离屏画布，不支持 OffscreenCanvas 时回退到普通 canvas
 * @param width - 画布宽度
 * @param height - 画布高度
 */
export function createOffscreenCanvas(
  width: number,
  height: number,
): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    return canvas;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

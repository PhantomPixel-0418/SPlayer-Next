import {
  IsolationRenderer,
  MeshGradientRenderer,
  PixiRenderer,
  type BaseRenderer,
} from "@applemusic-like-lyrics/core";
import type { PlayerBgRenderer } from "@/types/settings";
import { TitaniumRenderer } from "./amll/titanium";

const RENDERER_MAP: Record<PlayerBgRenderer, new (canvas: HTMLCanvasElement) => BaseRenderer> = {
  mesh: MeshGradientRenderer,
  isolation: IsolationRenderer,
  pixi: PixiRenderer,
  titanium: TitaniumRenderer,
};

/**
 * 按渲染器标识解析渲染器类
 * @param id - 渲染器标识
 * @returns 渲染器类；未知标识回落至网格渐变渲染器
 */
export const resolveRendererClass = (
  id: PlayerBgRenderer,
): new (canvas: HTMLCanvasElement) => BaseRenderer => RENDERER_MAP[id] ?? MeshGradientRenderer;

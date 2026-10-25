import {
  IsolationRenderer,
  MeshGradientRenderer,
  PixiRenderer,
  type BaseRenderer,
} from "@applemusic-like-lyrics/core";
import type { PlayerBgRenderer } from "@/types/settings";
import { TitaniumRenderer } from "./amll/titanium";

/** 渲染器标识可能来自旧版本持久化的配置，取值不受类型约束，故用 Partial */
const RENDERER_MAP: Partial<
  Record<PlayerBgRenderer, new (canvas: HTMLCanvasElement) => BaseRenderer>
> = {
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

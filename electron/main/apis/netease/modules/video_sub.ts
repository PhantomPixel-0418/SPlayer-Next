/**
 * 收藏 / 取消收藏视频
 *
 * params:
 * - id  视频 id
 * - t   1 收藏，0 取消收藏
 *
 * 响应：`{ code, ... }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const video_sub: NeteaseModule = (query, request) => {
  const action = String(query.t) === "1" ? "sub" : "unsub";
  const data = { id: query.id };
  return request(`/api/cloudvideo/video/${action}`, data, createOption(query, "weapi"));
};

export default video_sub;

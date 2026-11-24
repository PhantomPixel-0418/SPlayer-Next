/**
 * 视频播放地址
 *
 * params:
 * - id   视频 id
 * - res  清晰度（1080 / 720 / 480 / 240），默认 1080
 *
 * 响应：`{ code, data: [{ id, url, r, size, ... }] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const video_url: NeteaseModule = (query, request) => {
  const data = {
    ids: `["${query.id}"]`,
    resolution: query.res ?? 1080,
  };
  return request("/api/cloudvideo/playurl", data, createOption(query, "weapi"));
};

export default video_url;

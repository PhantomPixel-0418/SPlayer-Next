/**
 * MV 播放地址
 *
 * params:
 * - id  MV id
 * - r   清晰度（1080 / 720 / 480 / 240），默认 1080
 *
 * 响应：`{ code, data: { id, url, r, size, ... } }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const mv_url: NeteaseModule = (query, request) => {
  const data = {
    id: query.id,
    r: query.r ?? 1080,
  };
  return request("/api/song/enhance/play/mv/url", data, createOption(query, "weapi"));
};

export default mv_url;

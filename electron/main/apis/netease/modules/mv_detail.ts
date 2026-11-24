/**
 * MV 详情
 *
 * params:
 * - mvid  MV id
 *
 * 响应：`{ code, data: { id, name, artists, cover, desc, duration, playCount,
 * subCount, shareCount, commentCount, publishTime, brs: [{ br, size }], ... } }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const mv_detail: NeteaseModule = (query, request) => {
  const data = { id: query.mvid };
  return request("/api/v1/mv/detail", data, createOption(query, "weapi"));
};

export default mv_detail;

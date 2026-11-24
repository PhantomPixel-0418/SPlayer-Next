/**
 * 视频详情
 *
 * params:
 * - id  视频 id
 *
 * 响应：`{ code, data: { id, name, cover, description, duration, playCount,
 * subCount, shareCount, commentCount, publishTime, resolutions: [...], ... } }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const video_detail: NeteaseModule = (query, request) => {
  const data = { id: query.id };
  return request("/api/cloudvideo/v1/video/detail", data, createOption(query, "weapi"));
};

export default video_detail;

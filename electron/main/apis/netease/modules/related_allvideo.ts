/**
 * 相关视频（相关推荐）
 *
 * params:
 * - id  视频 id（纯数字按 MV 处理）
 *
 * 响应：`{ code, data: [{ id, name, coverUrl, playCount, durationms, type, ... }] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const related_allvideo: NeteaseModule = (query, request) => {
  const id = String(query.id ?? "");
  const data = {
    id,
    type: /^\d+$/.test(id) ? 0 : 1,
  };
  return request("/api/cloudvideo/v1/allvideo/rcmd", data, createOption(query, "weapi"));
};

export default related_allvideo;

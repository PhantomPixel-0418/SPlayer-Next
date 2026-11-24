/**
 * 推荐 MV
 *
 * 响应：`{ code, result: [{ id, name, picUrl, playCount, ... }], hasMore }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const personalized_mv: NeteaseModule = (query, request) => {
  return request("/api/personalized/mv", {}, createOption(query, "weapi"));
};

export default personalized_mv;

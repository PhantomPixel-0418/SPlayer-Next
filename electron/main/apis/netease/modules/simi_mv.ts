/**
 * 相似 MV（相关推荐）
 *
 * params:
 * - mvid  MV id
 *
 * 响应：`{ code, mvs: MvItem[] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const simi_mv: NeteaseModule = (query, request) => {
  const data = { mvid: query.mvid };
  return request("/api/discovery/simiMV", data, createOption(query, "weapi"));
};

export default simi_mv;

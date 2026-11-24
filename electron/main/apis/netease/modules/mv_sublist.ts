/**
 * 已收藏 MV 列表
 *
 * params:
 * - limit  返回数量，默认 25
 * - offset 偏移
 *
 * 响应：`{ code, data: MvItem[], hasMore, count }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const mv_sublist: NeteaseModule = (query, request) => {
  const data = {
    limit: query.limit ?? 25,
    offset: query.offset ?? 0,
    total: true,
  };
  return request("/api/cloudvideo/allvideo/sublist", data, createOption(query, "weapi"));
};

export default mv_sublist;

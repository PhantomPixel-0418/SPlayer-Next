/**
 * 收藏 / 取消收藏 MV
 *
 * params:
 * - mvid  MV id
 * - t     1 收藏，0 取消收藏
 *
 * 响应：`{ code, ... }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const mv_sub: NeteaseModule = (query, request) => {
  const action = String(query.t) === "1" ? "sub" : "unsub";
  const data = {
    mvId: query.mvid,
    mvIds: `["${query.mvid}"]`,
  };
  return request(`/api/mv/${action}`, data, createOption(query, "weapi"));
};

export default mv_sub;

/**
 * 全部 MV
 *
 * params:
 * - area  地区：全部 / 内地 / 港台 / 欧美 / 日本 / 韩国
 * - type  类型：全部 / 官方版 / 原生 / 现场版 / 网易出品
 * - order 排序：上升最快 / 最热 / 最新
 * - limit  返回数量，默认 30
 * - offset 偏移
 *
 * 响应：`{ code, data: MvItem[], hasMore, count }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const mv_all: NeteaseModule = (query, request) => {
  const data = {
    tags: JSON.stringify({
      地区: query.area || "全部",
      类型: query.type || "全部",
      排序: query.order || "上升最快",
    }),
    offset: query.offset ?? 0,
    total: true,
    limit: query.limit ?? 30,
  };
  return request("/api/mv/all", data, createOption(query));
};

export default mv_all;

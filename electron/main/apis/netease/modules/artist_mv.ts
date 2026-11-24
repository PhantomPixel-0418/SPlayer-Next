/**
 * 歌手相关 MV（分页）
 *
 * params:
 * - id     歌手 id
 * - limit  返回数量，默认 30
 * - offset 偏移
 *
 * 响应：`{ code, mvs: MvItem[], hasMore, time }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const artist_mv: NeteaseModule = (query, request) => {
  const data = {
    artistId: query.id,
    limit: query.limit ?? 30,
    offset: query.offset ?? 0,
    total: true,
  };
  return request("/api/artist/mvs", data, createOption(query, "weapi"));
};

export default artist_mv;
